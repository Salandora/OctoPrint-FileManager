# coding=utf-8
from __future__ import absolute_import

import threading

from flask import request, jsonify, make_response, url_for
from contextlib import contextmanager

from octoprint.settings import valid_boolean_trues
from octoprint.filemanager.destinations import FileDestinations
from octoprint.server.util.flask import restricted_access, get_json_command_from_request

import octoprint.plugin
from .ThreadPool import ThreadPool


class FilemanagerPlugin(octoprint.plugin.TemplatePlugin,
						octoprint.plugin.AssetPlugin,
						octoprint.plugin.BlueprintPlugin,
						octoprint.plugin.ShutdownPlugin,
						octoprint.plugin.SettingsPlugin):

	def initialize(self):
		self._worker_lock_mutex = threading.RLock()
		self._worker_locks = dict()

		self._workerProgress_lock_mutex = threading.RLock()
		self._workerProgress_locks = dict()

		self.workerPool = ThreadPool(5)
		self.workerBusy = 5 * [False]
		self.workerProgress = 5 * [dict(command="", progress=0, lastfile="")]

	def on_shutdown(self):
		if any(self.workerBusy):
			self._logger.warning("Some workers weren't ready, but OctoPrint got shutdown.")

	def get_assets(self):
		return dict(
			js=["js/jquery.fileDownload.js", "js/ko.single_double_click.js", "js/ko.marquee.js", "js/ko.stopBubble.js", "js/filemanager.js"],
			css=["css/fileManager-generated.min.css"],
			less=["less/fileManager.less"]
		)

	def get_settings_defaults(self):
		return dict(
			enableCheckboxes=False
		)

	def get_template_configs(self):
		return [
			dict(type="tab", template="filemanager_tab.jinja2", custom_bindings=True),
			dict(type="settings", template="filemanager_settings.jinja2", custom_bindings=False)
		]

	def _copyMoveCommand(self, workerID, target, command, source, destination):
		from octoprint.server.api.files import _verifyFolderExists, _verifyFileExists
		if not _verifyFileExists(target, source) and not _verifyFolderExists(target, source):
			return

		if _verifyFolderExists(target, destination):
			path, name = self._file_manager.split_path(target, source)
			destination = self._file_manager.join_path(target, destination, name)

		if _verifyFileExists(target, destination) or _verifyFolderExists(target, destination):
			return

		if command == "copy":
			if self._file_manager.file_exists(target, source):
				self._file_manager.copy_file(target, source, destination)
			elif self._file_manager.folder_exists(target, source):
				self._file_manager.copy_folder(target, source, destination)
		elif command == "move":
			from octoprint.server.api.files import _isBusy
			if _isBusy(target, source):
				self._plugin_manager.send_plugin_message(self._identifier,
														dict(type="failed", workerID=workerID, lastfile=source,
															reason="Trying to delete a file that is currently in use"))
				return

			# deselect the file if it's currently selected
			from octoprint.server.api.files import _getCurrentFile
			currentOrigin, currentFilename = _getCurrentFile()
			if currentFilename is not None and source == currentFilename:
				self._printer.unselect_file()

			if self._file_manager.file_exists(target, source):
				self._file_manager.move_file(target, source, destination)
			elif self._file_manager.folder_exists(target, source):
				self._file_manager.move_folder(target, source, destination)

	def _deleteCommand(self, workerID, target, source):
		from octoprint.server.api.files import _verifyFolderExists, _verifyFileExists, _isBusy

		# prohibit deleting or moving files that are currently in use
		from octoprint.server.api.files import _getCurrentFile
		currentOrigin, currentFilename = _getCurrentFile()

		if _verifyFileExists(target, source):
			if _isBusy(target, source):
				self._plugin_manager.send_plugin_message(self._identifier,
														dict(type="failed", workerID=workerID, lastfile=source,
															reason="Trying to delete a file that is currently in use"))
				return

			# deselect the file if it's currently selected
			if currentFilename is not None and source == currentFilename:
				self._printer.unselect_file()

			# delete it
			if target == FileDestinations.SDCARD:
				self._printer.delete_sd_file(source)
			else:
				self._file_manager.remove_file(target, source)
		elif _verifyFolderExists(target, source):
			if not target in [FileDestinations.LOCAL]:
				return make_response("Unknown target: %s" % target, 404)

			folderpath = source
			if _isBusy(target, folderpath):
				self._plugin_manager.send_plugin_message(self._identifier,
														dict(type="failed", workerID=workerID, lastfile=folderpath,
															reason="Trying to delete a folder that contains a file that is currently in use"))
				return

			# deselect the file if it's currently selected
			if currentFilename is not None and self._file_manager.file_in_path(target, folderpath, currentFilename):
				self._printer.unselect_file()

			# delete it
			self._file_manager.remove_folder(target, folderpath)

	def _findFreeWorker(self):
		with self._worker_lock_mutex:
			for i, e in enumerate(self.workerBusy):
				if not e:
					return i

		return -1

	def _resetWorkerProgress(self, workerID):
		with self._get_workerProgress_lock(workerID):
			self.workerProgress[workerID] = dict(command="", progress=0, lastfile="")

	def _bulkOperationThread(self, workerID, target, command, sources, destinations):
		with self._get_worker_lock(workerID):
			self.workerBusy[workerID] = True

		with self._get_workerProgress_lock(workerID):
			self.workerProgress[workerID]["command"] = command

		try:
			len_sources = len(sources)
			if command == "copy" or command == "move" and target == FileDestinations.LOCAL:
				for i, source in enumerate(sources):
					with self._get_workerProgress_lock(workerID):
						self.workerProgress[workerID]["progress"] = i / len_sources
						self.workerProgress[workerID]["lastfile"] = source
						self._plugin_manager.send_plugin_message(self._identifier,
																dict(type="progress", workerID=workerID).update(self.workerProgress[workerID]))

					self._copyMoveCommand(workerID, target, command, source,
										destinations[i] if isinstance(destinations, list) else destinations)
			elif command == "delete":
				for i, source in enumerate(sources):
					with self._get_workerProgress_lock(workerID):
						self.workerProgress[workerID]["progress"] = i / len_sources
						self.workerProgress[workerID]["lastfile"] = source
						self._plugin_manager.send_plugin_message(self._identifier,
																dict(type="progress", workerID=workerID).update(self.workerProgress[workerID]))

					self._deleteCommand(workerID, target, source)
		finally:
			with self._get_worker_lock(workerID):
				self.workerBusy[workerID] = False

			self._resetWorkerProgress(workerID)
			self._plugin_manager.send_plugin_message(self._identifier, dict(type="done", workerID=workerID))

	@octoprint.plugin.BlueprintPlugin.route("/files/<string:target>/bulkOperation", methods=["POST"])
	@restricted_access
	def bulkOperation(self, target):
		if target not in [FileDestinations.LOCAL, FileDestinations.SDCARD]:
			return make_response("Unknown target: %s" % target, 404)

		worker = self._findFreeWorker()
		if worker == -1:
			return make_response("Too many operations", 429)

		# valid file commands, dict mapping command name to mandatory parameters
		valid_commands = {
			"copy": ["sources", "destinations"],
			"move": ["sources", "destinations"],
			"delete": ["sources"]
		}

		command, data, response = get_json_command_from_request(request, valid_commands)
		if response is not None:
			return response

		self.workerPool.add_task(self._bulkOperationThread, worker, target, command, data["sources"], data.get("destinations", None))

		return make_response("WorkerID: %d" % worker, 202)

	@octoprint.plugin.BlueprintPlugin.route("/files/<string:target>/<path:filename>", methods=["POST"])
	@restricted_access
	def gcodeFileCommand(self, target, filename):
		if target not in [FileDestinations.LOCAL]:
			return make_response("Unknown target: %s" % target, 404)

		if not self._settings.global_get_boolean(["feature", "sdSupport"]):
			return make_response("SD card support is disabled", 404)

		# valid file commands, dict mapping command name to mandatory parameters
		valid_commands = {
			"uploadSd": []
		}

		command, data, response = get_json_command_from_request(request, valid_commands)
		if response is not None:
			return response

		if command == "uploadSd":
			from octoprint.server.api.files import _verifyFolderExists, _verifyFileExists
			if not _verifyFileExists(FileDestinations.LOCAL, filename):
				return make_response("File not found on '%s': %s" % (FileDestinations.LOCAL, filename), 404)

			from octoprint.filemanager import valid_file_type
			if not valid_file_type(filename, type="machinecode"):
				return make_response("Cannot upload {filename} to SD, not a machinecode file".format(**locals()), 415)

			# validate that all preconditions for SD upload are met before attempting it
			if not (self._printer.is_operational() and not (self._printer.is_printing() or self._printer.is_paused())):
				return make_response("Can not upload to SD card, printer is either not operational or already busy",
									 409)
			if not self._printer.is_sd_ready():
				return make_response("Can not upload to SD card, not yet initialized", 409)

			# determine current job
			currentFilename = None
			currentFullPath = None
			currentOrigin = None
			currentJob = self._printer.get_current_job()
			if currentJob is not None and "file" in currentJob.keys():
				currentJobFile = currentJob["file"]
				if currentJobFile is not None and "name" in currentJobFile.keys() and "origin" in currentJobFile.keys() and \
								currentJobFile["name"] is not None and currentJobFile["origin"] is not None:
					currentPath, currentFilename = self._file_manager.split_path(FileDestinations.LOCAL,
																				 currentJobFile["name"])
					currentOrigin = currentJobFile["origin"]

			selectAfterUpload = "select" in request.values.keys() and request.values["select"] in valid_boolean_trues
			printAfterSelect = "print" in request.values.keys() and request.values["print"] in valid_boolean_trues

			filePath, fileName = self._file_manager.sanitize(FileDestinations.LOCAL, filename)
			fullPath = self._file_manager.join_path(FileDestinations.LOCAL, filePath, fileName)

			def selectAndOrPrint(filename, absFilename, destination):
				"""
				Callback for when the file is ready to be selected and optionally printed. For SD file uploads this is only
				the case after they have finished streaming to the printer, which is why this callback is also used
				for the corresponding call to addSdFile.

				Selects the just uploaded file if either selectAfterUpload or printAfterSelect are True, or if the
				exact file is already selected, such reloading it.
				"""
				if selectAfterUpload or printAfterSelect or (
								currentFilename == filename and currentOrigin == destination):
					self._printer.select_file(absFilename, destination == FileDestinations.SDCARD, printAfterSelect)

			sdFilename = self._printer.add_sd_file(fileName, fullPath, selectAndOrPrint)

			from octoprint.events import Events
			self._event_bus.fire(Events.UPLOAD, {"file": sdFilename, "target": FileDestinations.SDCARD})

			location = url_for("api.readGcodeFile", target=FileDestinations.SDCARD, filename=sdFilename, _external=True)
			files = {
				FileDestinations.SDCARD: {
					"name": sdFilename,
					"origin": FileDestinations.SDCARD,
					"refs": {
						"resource": location
					}
				}
			}

			r = make_response(jsonify(files=files, done=True), 201)
			r.headers["Location"] = location
			return r

	@contextmanager
	def _get_worker_lock(self, workerID):
		with self._worker_lock_mutex:
			if workerID not in self._worker_locks:
				import threading
				self._worker_locks[workerID] = (0, threading.RLock())

			counter, lock = self._worker_locks[workerID]
			counter += 1
			self._worker_locks[workerID] = (counter, lock)

			yield lock

			counter = self._worker_locks[workerID][0]
			counter -= 1
			if counter <= 0:
				del self._worker_locks[workerID]
			else:
				self._worker_locks[workerID] = (counter, lock)

	@contextmanager
	def _get_workerProgress_lock(self, workerID):
		with self._workerProgress_lock_mutex:
			if workerID not in self._workerProgress_locks:
				import threading
				self._workerProgress_locks[workerID] = (0, threading.RLock())

			counter, lock = self._workerProgress_locks[workerID]
			counter += 1
			self._workerProgress_locks[workerID] = (counter, lock)

			yield lock

			counter = self._workerProgress_locks[workerID][0]
			counter -= 1
			if counter <= 0:
				del self._workerProgress_locks[workerID]
			else:
				self._workerProgress_locks[workerID] = (counter, lock)

	##~~ Softwareupdate hook

	def get_update_information(self):
		# Define the configuration for your plugin to use with the Software Update
		# Plugin here. See https://github.com/foosel/OctoPrint/wiki/Plugin:-Software-Update
		# for details.
		return dict(
			filemanager=dict(
				displayName="FileManager Plugin",
				displayVersion=self._plugin_version,

				# version check: github repository
				type="github_release",
				user="Salandora",
				repo="OctoPrint-FileManager",
				current=self._plugin_version,

				stable_branch=dict(
					name="Stable",
					branch="master",
					comittish=[
						"master"
					]
				),
				prerelease_branches=[
					dict(
						name="Development",
						branch="devel",
						comittish=[
							"devel",
							"master"
						]
					)
				],

				# update method: pip
				pip="https://github.com/Salandora/OctoPrint-FileManager/archive/{target_version}.zip"
			)
		)


__plugin_name__ = "FileManager"
__plugin_pythoncompat__ = ">=2.7,<4"


def __plugin_load__():
	global __plugin_implementation__
	__plugin_implementation__ = FilemanagerPlugin()

	global __plugin_hooks__
	__plugin_hooks__ = {
		"octoprint.plugin.softwareupdate.check_config": __plugin_implementation__.get_update_information
	}
