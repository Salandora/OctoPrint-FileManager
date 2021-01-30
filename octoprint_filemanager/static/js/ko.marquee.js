ko.bindingHandlers.marquee = {
    init: function (element, valueAccessor, allBindingsAccessor, context) {
        var getSize = function (element) {
            var container = $('<div></div>');
            container.css({
                'position': 'absolute',
                'left:' : '-1000px',
                'top:' : '-1000px',
                'width': 'auto',
                'height': 'auto'
            });

            container.append(element.clone());
            $('body').append(container);
            var rect = { width: container.width(), height: container.height() };
            container.remove();

            return rect;
        };

        var value = valueAccessor();
        var valueUnwrapped = ko.unwrap(value);

        var $element = $(element);

        $element.addClass(valueUnwrapped.class);
        $element.parent().on('mouseenter', function() {
            var width = getSize($element).width;
            var distance = width - $element.width();

            if (distance <= 0)
                return;

            var speed = valueUnwrapped.speed ?? 100; // px/sec
            var time = distance / speed;

            $element.css({
                'margin-left': '-' + distance + 'px',
                'transition-duration': time + 's'
            });
        }).on('mouseleave', function() {
            $element.css({
                'margin-left': '0'
            });
        });
    }
};
