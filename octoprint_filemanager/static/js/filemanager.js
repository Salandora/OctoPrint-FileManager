/**
 * Created by Salandora on 06.09.2015.
 */

$(function() {
    $("head").append('<meta name="viewport" content="width=device-width, initial-scale=1.0">');

    function FilemanagerViewModel(parameters) {
        var self = this;

        self.API_BASEURL = "plugin/filemanager/";
        self.API_FILESURL = self.API_BASEURL + "files/";

        self.files = parameters[0];
        self.loginState = parameters[1];
        self.slicing = parameters[2];

        self.selectedFiles = ko.observableArray([]);
        self.currentPath = ko.observable("");
        self.listStyle = ko.observable("folders_files");

        self.actionObject = ko.observable({ action: undefined, array: [] });

        // For Rename and Create Folder dialog
        self.name = ko.observable("");

        self.fileListHelper = new ItemListHelper(
            "filemanagerList",
            {
                "nameAsc": function(a, b) {
                    // sorts ascending
                    if (a["name"].toLocaleLowerCase() < b["name"].toLocaleLowerCase()) return -1;
                    if (a["name"].toLocaleLowerCase() > b["name"].toLocaleLowerCase()) return 1;
                    return 0;
                },
                "nameDsc": function(a, b) {
                    // sorts descending
                    if (a["name"].toLocaleLowerCase() < b["name"].toLocaleLowerCase()) return 1;
                    if (a["name"].toLocaleLowerCase() > b["name"].toLocaleLowerCase()) return -1;
                    return 0;
                },
                "uploadAsc": function(a, b) {
                    // sorts ascending
                    if (b["date"] === undefined || a["date"] > b["date"]) return 1;
                    if (a["date"] < b["date"]) return -1;
                    return 0;
                },
                "uploadDsc": function(a, b) {
                    // sorts descending
                    if (b["date"] === undefined || a["date"] > b["date"]) return -1;
                    if (a["date"] < b["date"]) return 1;
                    return 0;
                },
                "sizeAsc": function(a, b) {
                    // sorts ascending
                    if (b["size"] === undefined || a["size"] > b["size"]) return 1;
                    if (a["size"] < b["size"]) return -1;
                    return 0;
                },
                "sizeDsc": function(a, b) {
                    // sorts descending
                    if (b["size"] === undefined || a["size"] > b["size"]) return -1;
                    if (a["size"] < b["size"]) return 1;
                    return 0;
                }
            },
            {
                "printed": function(data) {
                    return !(data["prints"] && data["prints"]["success"] && data["prints"]["success"] > 0);
                },
                "sd": function(data) {
                    return data["origin"] && data["origin"] == "sdcard";
                },
                "local": function(data) {
                    return !(data["origin"] && data["origin"] == "sdcard");
                },
                "machinecode": function(data) {
                    return data["type"] && (data["type"] == "machinecode");
                },
                "model": function(data) {
                    return data["type"] && (data["type"] == "model");
                }
            },
            "nameAsc",
            [],
            [["sd", "local"], ["machinecode", "model"]],
            0
        );

        self.foldersOnlyList = function() {
            filter = function(data) { return data["type"] && data["type"] == "folder"; };
            return _.filter(self.fileListHelper.paginatedItems(), filter);
        };
        self.filesOnlyList = function() {
            filter = function(data) { return data["type"] && data["type"] != "folder"; };
            return _.filter(self.fileListHelper.paginatedItems(), filter);
        };

        if (self.files.hasOwnProperty("allItems"))
            self.files.allItems.subscribe(function (newValue) {
                self.fileListHelper.updateItems(newValue);
                self.selectedFiles([]);
                self.changeFolderByPath(self.currentPath());
            });

        self.dblClick = function(data) {
            if (!data.hasOwnProperty("type"))
                return;

            if (data.type == "folder")
                self.changeFolder(data);
            else if (data.type == "machinecode" && self.files.enableSelect(data, false))
                self.files.loadFile(data, false);
        };

        self.changeFolder = function(data) {
            self.selectedFiles([]);

            self.currentPath(OctoPrint.files.pathForEntry(data));
            self.fileListHelper.updateItems(data.children);
        };
        self.changeFolderByPath = function(path) {
            var element = self.files.elementByPath(path, { children: self.files.allItems() });
            if (element) {
                self.currentPath(path);
                self.fileListHelper.updateItems(element.children);
            }
            else{
                self.currentPath("");
                self.fileListHelper.updateItems(self.files.allItems());
            }
        };

        self.selectItem = function(data, event) {
            if (self.isSelected(data))
                self.selectedFiles.remove(data);
            else
                self.selectedFiles.push(data);
        };
        self.isSelected = function(data) {
            return self.selectedFiles.indexOf(data) != -1;
        };

        self.templateFor = function(data) {
            return "filemanager_template_" + data.type;
        };

        self.getEntryId = function(data) {
            return "filemanager_entry_" + md5(data["origin"] + ":" + data["name"]);
        };

        self.checkSelectedOrigin = function(origin) {
            var selectedFiles = self.selectedFiles();
            for (var i = 0; i < selectedFiles.length; i++) {
                var element = selectedFiles[i];
                if (!element.hasOwnProperty("origin") || element.origin != origin)
                    return false;
            }

            return true;
        };

        self.enableDownload = function() {
            var selected = self.selectedFiles();

            _.each(self.selectedFiles(), function(element) {
                if (!element.hasOwnProperty("type") || !element.hasOwnProperty("origin") || element.type == "folder" || element.origin != "local")
                    return false;
            });

            return selected.length != 0;
        };
        self.enableUploadSD = function() {
            return self.loginState.isUser() && self.selectedFiles().length == 1 && self.files.isSdReady() && self.checkSelectedOrigin("local");
        };
        self.enableRemove = function() {
            if (!self.loginState.isUser() || self.selectedFiles().length == 0)
                return false;

            var files = self.selectedFiles();
            for (var i = 0; i < files.length; i++) {
                if (!self.files.enableRemove(files[i]))
                    return false;
            }
            return true;
        };
        self.enableSlicing = function() {
            var files = self.selectedFiles();
            if (files.length != 1)
                return false;

            return files[0].type == "model" && self.files.enableSlicing(files[0]);
        };
        self.enableSelect = function(printAfterSelect) {
            var files = self.selectedFiles();
            if (files.length != 1)
                return false;

            return files[0].type == "machinecode" && self.files.enableSelect(files[0], printAfterSelect);
        };
        self.enableRename = function() {
            return self.loginState.isUser() && self.selectedFiles().length == 1 && self.checkSelectedOrigin("local");
        };
        self.enableCopy = function() {
            return self.loginState.isUser() && self.selectedFiles().length > 0 && self.checkSelectedOrigin("local");
        };
        self.enablePaste = function() {
            return self.loginState.isUser() && self.actionObject().array.length > 0 && self.checkSelectedOrigin("local");
        };

        self.download = function() {
            if (!self.enableDownload())
                return;

            _.each(self.selectedFiles(), function(file, index) {
                $.fileDownload(self.files.downloadLink(file), { data: { "cookie": "fileDownload" + index }, cookieName: "fileDownload" + index });
            })
        };
        self.uploadSD = function() {
            if (!self.enableUploadSD())
                return;

            var element = self.selectedFiles()[0];
            var path = OctoPrint.files.pathForEntry(element);

            var data = {
                command: "uploadSd"
            };

            OctoPrint.postJson(self.API_FILESURL + "local/" + path, data);
        };
        self.remove = function() {
            if (!self.enableRemove())
                return;

            if (self.selectedFiles().length > 1) {
                var sortedByOrigins = {};
                _.each(self.selectedFiles(), function (element) {
                    if (!self.files.enableRemove(element) || !element.hasOwnProperty("origin"))
                        return;

                    var origin = element["origin"];
                    if (!sortedByOrigins.hasOwnProperty(origin))
                        sortedByOrigins[origin] = [];

                    sortedByOrigins[origin].push(OctoPrint.files.pathForEntry(element));
                });

                _.each(sortedByOrigins, function (value, key) {
                    var data = {command: "delete", sources: value};
                    OctoPrint.postJson(self.API_FILESURL + key + "/bulkOperation", data);
                });
            }
            else {
                self.files.removeFile(self.selectedFiles()[0]);
            }
        };
        self.slice = function() {
            if (!self.enableSlicing())
                return;

            self.files.sliceFile(self.selectedFiles()[0]);
        };

        self.loadFile = function(printAfterSelect) {
            if (!self.enableSelect(printAfterSelect))
                return;

            self.files.loadFile(self.selectedFiles()[0], printAfterSelect);
        };

        self.showAddFolderDialog = function() {
            if (!self.loginState.isUser())
                return;

            var activeFolder = self.files.currentPath();
            self.files.changeFolderByPath(self.currentPath());

            self.files.addFolderDialog.one("hidden", function() {
                self.files.changeFolderByPath(activeFolder);
            });

            self.files.showAddFolderDialog();
        };
        self.rename = function() {
            if (!self.enableRename())
                return;

            self.name(self.selectedFiles()[0].name);

            var dialog = $("#fileManagerNameDialog");
            var primarybtn = $('div.modal-footer .btn-primary', dialog);

            primarybtn.unbind('click').bind('click', function (e) {
                var element = self.selectedFiles()[0];
                var oldname = element.name;
                var source = OctoPrint.files.pathForEntry(element);
                element.name = self.name();
                var destination = OctoPrint.files.pathForEntry(element);
                element.name = oldname;

                OctoPrint.files.move("local", source, destination);
            });

            dialog.modal({
                show: 'true',
                backdrop: 'static'
            });
        };

        self.copy = function() {
            if (!self.enableCopy())
                return;

            var tmp = {
                action: "copy",
                array : []
            };

            _.each(self.selectedFiles(), function(element) {
                tmp.array.push(OctoPrint.files.pathForEntry(element));
            });

            self.actionObject(tmp);
            self.selectedFiles([]);
        };
        self.cut = function() {
            if (!self.enableRemove() || !self.checkSelectedOrigin("local"))
                return;

            var tmp = {
                action: "move",
                array: []
            };

            _.each(self.selectedFiles(), function(element) {
                tmp.array.push(OctoPrint.files.pathForEntry(element));
            });

            self.actionObject(tmp);
            self.selectedFiles([]);
        };
        self.paste = function() {
            if (!self.enablePaste())
                return;

            var action = function(data) {
                if (data.sources.length > 1) {
                    OctoPrint.postJson(self.API_FILESURL + "local/bulkOperation", data);
                }
                else {
                    if (data.command == "copy") {
                        OctoPrint.files.copy("local", data.sources[0], data.destinations);
                    }
                    else if (data.command == "move") {
                        OctoPrint.files.move("local", data.sources[0], data.destinations);
                    }
                }
            };

            var data = {
                command: self.actionObject().action,
                sources: self.actionObject().array,
                destinations: self.currentPath()
            };
            self.actionObject({ action: undefined, array: [] });

            if (self.selectedFiles().length == 0) {
                action(data);
            }
            else if (self.selectedFiles().length == 1) {
                var dst = self.selectedFiles()[0];
                if (dst.type == "folder")
                    data.destinations = OctoPrint.files.pathForEntry(dst);

                action(data);
            }
        };

        self.onStartup = function() {
            $(".filemanager_files").slimScroll({
                height: "auto",
                size: "5px",
                distance: "0",
                railVisible: true,
                alwaysVisible: true,
                scrollBy: "102px"
            });

            self.addFolderDialog = $("#add_folder_dialog");
        };
    }

    OCTOPRINT_VIEWMODELS.push([
        FilemanagerViewModel,
        ["gcodeFilesViewModel", "loginStateViewModel", "slicingViewModel"],
        ["#tab_plugin_filemanager", "#fileManagerNameDialog"]
    ]);
});