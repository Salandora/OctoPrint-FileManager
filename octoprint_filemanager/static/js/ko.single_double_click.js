ko.bindingHandlers.singleOrDoubleClick = {
    init: function(element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {
        var value = ko.utils.unwrapObservable(valueAccessor());

        var singleHandler = undefined,
            doubleHandler = undefined,
            delay = 250,
            clicks = 0;

        if (_.isObject(value)) {
            singleHandler = value.click;
            doubleHandler = value.dblclick;
            delay = ko.utils.unwrapObservable(value.delay) || delay;
        }
        else {
            singleHandler = value;
        }

        $(element).click(function(e) {
            var sel = getSelection().toString();
            if(sel)
                return;

            clicks++;
            if (clicks === 1) {
                $(element).css('user-select', 'none');
                setTimeout(function () {
                    $(element).css('user-select', 'auto');
                    if (clicks === 1) {
                        if (singleHandler !== undefined) {
                            singleHandler.call(this, bindingContext.$data, e);
                        }
                    } else {
                        if (doubleHandler !== undefined) {
                            doubleHandler.call(this, bindingContext.$data, e);
                        }
                    }
                    clicks = 0;
                }, delay);
            }
        });
    }
};
