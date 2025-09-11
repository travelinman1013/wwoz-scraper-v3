/* ========================================================================
 * Bootstrap: button.js v3.3.7
 * http://getbootstrap.com/javascript/#buttons
 * ========================================================================
 * Copyright 2011-2016 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // BUTTON PUBLIC CLASS DEFINITION
  // ==============================

  var Button = function (element, options) {
    this.$element  = $(element)
    this.options   = $.extend({}, Button.DEFAULTS, options)
    this.isLoading = false
  }

  Button.VERSION  = '3.3.7'

  Button.DEFAULTS = {
    loadingText: 'loading...'
  }

  Button.prototype.setState = function (state) {
    var d    = 'disabled'
    var $el  = this.$element
    var val  = $el.is('input') ? 'val' : 'html'
    var data = $el.data()

    state += 'Text'

    if (data.resetText == null) $el.data('resetText', $el[val]())

    // push to event loop to allow forms to submit
    setTimeout($.proxy(function () {
      $el[val](data[state] == null ? this.options[state] : data[state])

      if (state == 'loadingText') {
        this.isLoading = true
        $el.addClass(d).attr(d, d).prop(d, true)
      } else if (this.isLoading) {
        this.isLoading = false
        $el.removeClass(d).removeAttr(d).prop(d, false)
      }
    }, this), 0)
  }

  Button.prototype.toggle = function () {
    var changed = true
    var $parent = this.$element.closest('[data-toggle="buttons"]')

    if ($parent.length) {
      var $input = this.$element.find('input')
      if ($input.prop('type') == 'radio') {
        if ($input.prop('checked')) changed = false
        $parent.find('.active').removeClass('active')
        this.$element.addClass('active')
      } else if ($input.prop('type') == 'checkbox') {
        if (($input.prop('checked')) !== this.$element.hasClass('active')) changed = false
        this.$element.toggleClass('active')
      }
      $input.prop('checked', this.$element.hasClass('active'))
      if (changed) $input.trigger('change')
    } else {
      this.$element.attr('aria-pressed', !this.$element.hasClass('active'))
      this.$element.toggleClass('active')
    }
  }


  // BUTTON PLUGIN DEFINITION
  // ========================

  function Plugin(option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.button')
      var options = typeof option == 'object' && option

      if (!data) $this.data('bs.button', (data = new Button(this, options)))

      if (option == 'toggle') data.toggle()
      else if (option) data.setState(option)
    })
  }

  var old = $.fn.button

  $.fn.button             = Plugin
  $.fn.button.Constructor = Button


  // BUTTON NO CONFLICT
  // ==================

  $.fn.button.noConflict = function () {
    $.fn.button = old
    return this
  }


  // BUTTON DATA-API
  // ===============

  $(document)
    .on('click.bs.button.data-api', '[data-toggle^="button"]', function (e) {
      var $btn = $(e.target).closest('.btn')
      Plugin.call($btn, 'toggle')
      if (!($(e.target).is('input[type="radio"], input[type="checkbox"]'))) {
        // Prevent double click on radios, and the double selections (so cancellation) on checkboxes
        e.preventDefault()
        // The target component still receive the focus
        if ($btn.is('input,button')) $btn.trigger('focus')
        else $btn.find('input:visible,button:visible').first().trigger('focus')
      }
    })
    .on('focus.bs.button.data-api blur.bs.button.data-api', '[data-toggle^="button"]', function (e) {
      $(e.target).closest('.btn').toggleClass('focus', /^focus(in)?$/.test(e.type))
    })

}(jQuery);
;
/* ========================================================================
 * Bootstrap: carousel.js v3.3.7
 * http://getbootstrap.com/javascript/#carousel
 * ========================================================================
 * Copyright 2011-2016 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // CAROUSEL CLASS DEFINITION
  // =========================

  var Carousel = function (element, options) {
    this.$element    = $(element)
    this.$indicators = this.$element.find('.carousel-indicators')
    this.options     = options
    this.paused      = null
    this.sliding     = null
    this.interval    = null
    this.$active     = null
    this.$items      = null

    this.options.keyboard && this.$element.on('keydown.bs.carousel', $.proxy(this.keydown, this))

    this.options.pause == 'hover' && !('ontouchstart' in document.documentElement) && this.$element
      .on('mouseenter.bs.carousel', $.proxy(this.pause, this))
      .on('mouseleave.bs.carousel', $.proxy(this.cycle, this))
  }

  Carousel.VERSION  = '3.3.7'

  Carousel.TRANSITION_DURATION = 600

  Carousel.DEFAULTS = {
    interval: 5000,
    pause: 'hover',
    wrap: true,
    keyboard: true
  }

  Carousel.prototype.keydown = function (e) {
    if (/input|textarea/i.test(e.target.tagName)) return
    switch (e.which) {
      case 37: this.prev(); break
      case 39: this.next(); break
      default: return
    }

    e.preventDefault()
  }

  Carousel.prototype.cycle = function (e) {
    e || (this.paused = false)

    this.interval && clearInterval(this.interval)

    this.options.interval
      && !this.paused
      && (this.interval = setInterval($.proxy(this.next, this), this.options.interval))

    return this
  }

  Carousel.prototype.getItemIndex = function (item) {
    this.$items = item.parent().children('.item')
    return this.$items.index(item || this.$active)
  }

  Carousel.prototype.getItemForDirection = function (direction, active) {
    var activeIndex = this.getItemIndex(active)
    var willWrap = (direction == 'prev' && activeIndex === 0)
                || (direction == 'next' && activeIndex == (this.$items.length - 1))
    if (willWrap && !this.options.wrap) return active
    var delta = direction == 'prev' ? -1 : 1
    var itemIndex = (activeIndex + delta) % this.$items.length
    return this.$items.eq(itemIndex)
  }

  Carousel.prototype.to = function (pos) {
    var that        = this
    var activeIndex = this.getItemIndex(this.$active = this.$element.find('.item.active'))

    if (pos > (this.$items.length - 1) || pos < 0) return

    if (this.sliding)       return this.$element.one('slid.bs.carousel', function () { that.to(pos) }) // yes, "slid"
    if (activeIndex == pos) return this.pause().cycle()

    return this.slide(pos > activeIndex ? 'next' : 'prev', this.$items.eq(pos))
  }

  Carousel.prototype.pause = function (e) {
    e || (this.paused = true)

    if (this.$element.find('.next, .prev').length && $.support.transition) {
      this.$element.trigger($.support.transition.end)
      this.cycle(true)
    }

    this.interval = clearInterval(this.interval)

    return this
  }

  Carousel.prototype.next = function () {
    if (this.sliding) return
    return this.slide('next')
  }

  Carousel.prototype.prev = function () {
    if (this.sliding) return
    return this.slide('prev')
  }

  Carousel.prototype.slide = function (type, next) {
    var $active   = this.$element.find('.item.active')
    var $next     = next || this.getItemForDirection(type, $active)
    var isCycling = this.interval
    var direction = type == 'next' ? 'left' : 'right'
    var that      = this

    if ($next.hasClass('active')) return (this.sliding = false)

    var relatedTarget = $next[0]
    var slideEvent = $.Event('slide.bs.carousel', {
      relatedTarget: relatedTarget,
      direction: direction
    })
    this.$element.trigger(slideEvent)
    if (slideEvent.isDefaultPrevented()) return

    this.sliding = true

    isCycling && this.pause()

    if (this.$indicators.length) {
      this.$indicators.find('.active').removeClass('active')
      var $nextIndicator = $(this.$indicators.children()[this.getItemIndex($next)])
      $nextIndicator && $nextIndicator.addClass('active')
    }

    var slidEvent = $.Event('slid.bs.carousel', { relatedTarget: relatedTarget, direction: direction }) // yes, "slid"
    if ($.support.transition && this.$element.hasClass('slide')) {
      $next.addClass(type)
      $next[0].offsetWidth // force reflow
      $active.addClass(direction)
      $next.addClass(direction)
      $active
        .one('bsTransitionEnd', function () {
          $next.removeClass([type, direction].join(' ')).addClass('active')
          $active.removeClass(['active', direction].join(' '))
          that.sliding = false
          setTimeout(function () {
            that.$element.trigger(slidEvent)
          }, 0)
        })
        .emulateTransitionEnd(Carousel.TRANSITION_DURATION)
    } else {
      $active.removeClass('active')
      $next.addClass('active')
      this.sliding = false
      this.$element.trigger(slidEvent)
    }

    isCycling && this.cycle()

    return this
  }


  // CAROUSEL PLUGIN DEFINITION
  // ==========================

  function Plugin(option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.carousel')
      var options = $.extend({}, Carousel.DEFAULTS, $this.data(), typeof option == 'object' && option)
      var action  = typeof option == 'string' ? option : options.slide

      if (!data) $this.data('bs.carousel', (data = new Carousel(this, options)))
      if (typeof option == 'number') data.to(option)
      else if (action) data[action]()
      else if (options.interval) data.pause().cycle()
    })
  }

  var old = $.fn.carousel

  $.fn.carousel             = Plugin
  $.fn.carousel.Constructor = Carousel


  // CAROUSEL NO CONFLICT
  // ====================

  $.fn.carousel.noConflict = function () {
    $.fn.carousel = old
    return this
  }


  // CAROUSEL DATA-API
  // =================

  var clickHandler = function (e) {
    var href
    var $this   = $(this)
    var $target = $($this.attr('data-target') || (href = $this.attr('href')) && href.replace(/.*(?=#[^\s]+$)/, '')) // strip for ie7
    if (!$target.hasClass('carousel')) return
    var options = $.extend({}, $target.data(), $this.data())
    var slideIndex = $this.attr('data-slide-to')
    if (slideIndex) options.interval = false

    Plugin.call($target, options)

    if (slideIndex) {
      $target.data('bs.carousel').to(slideIndex)
    }

    e.preventDefault()
  }

  $(document)
    .on('click.bs.carousel.data-api', '[data-slide]', clickHandler)
    .on('click.bs.carousel.data-api', '[data-slide-to]', clickHandler)

  $(window).on('load', function () {
    $('[data-ride="carousel"]').each(function () {
      var $carousel = $(this)
      Plugin.call($carousel, $carousel.data())
    })
  })

}(jQuery);
;
/* ========================================================================
 * Bootstrap: collapse.js v3.3.7
 * http://getbootstrap.com/javascript/#collapse
 * ========================================================================
 * Copyright 2011-2016 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */

/* jshint latedef: false */

+function ($) {
  'use strict';

  // COLLAPSE PUBLIC CLASS DEFINITION
  // ================================

  var Collapse = function (element, options) {
    this.$element      = $(element)
    this.options       = $.extend({}, Collapse.DEFAULTS, options)
    this.$trigger      = $('[data-toggle="collapse"][href="#' + element.id + '"],' +
                           '[data-toggle="collapse"][data-target="#' + element.id + '"]')
    this.transitioning = null

    if (this.options.parent) {
      this.$parent = this.getParent()
    } else {
      this.addAriaAndCollapsedClass(this.$element, this.$trigger)
    }

    if (this.options.toggle) this.toggle()
  }

  Collapse.VERSION  = '3.3.7'

  Collapse.TRANSITION_DURATION = 350

  Collapse.DEFAULTS = {
    toggle: true
  }

  Collapse.prototype.dimension = function () {
    var hasWidth = this.$element.hasClass('width')
    return hasWidth ? 'width' : 'height'
  }

  Collapse.prototype.show = function () {
    if (this.transitioning || this.$element.hasClass('in')) return

    var activesData
    var actives = this.$parent && this.$parent.children('.panel').children('.in, .collapsing')

    if (actives && actives.length) {
      activesData = actives.data('bs.collapse')
      if (activesData && activesData.transitioning) return
    }

    var startEvent = $.Event('show.bs.collapse')
    this.$element.trigger(startEvent)
    if (startEvent.isDefaultPrevented()) return

    if (actives && actives.length) {
      Plugin.call(actives, 'hide')
      activesData || actives.data('bs.collapse', null)
    }

    var dimension = this.dimension()

    this.$element
      .removeClass('collapse')
      .addClass('collapsing')[dimension](0)
      .attr('aria-expanded', true)

    this.$trigger
      .removeClass('collapsed')
      .attr('aria-expanded', true)

    this.transitioning = 1

    var complete = function () {
      this.$element
        .removeClass('collapsing')
        .addClass('collapse in')[dimension]('')
      this.transitioning = 0
      this.$element
        .trigger('shown.bs.collapse')
    }

    if (!$.support.transition) return complete.call(this)

    var scrollSize = $.camelCase(['scroll', dimension].join('-'))

    this.$element
      .one('bsTransitionEnd', $.proxy(complete, this))
      .emulateTransitionEnd(Collapse.TRANSITION_DURATION)[dimension](this.$element[0][scrollSize])
  }

  Collapse.prototype.hide = function () {
    if (this.transitioning || !this.$element.hasClass('in')) return

    var startEvent = $.Event('hide.bs.collapse')
    this.$element.trigger(startEvent)
    if (startEvent.isDefaultPrevented()) return

    var dimension = this.dimension()

    this.$element[dimension](this.$element[dimension]())[0].offsetHeight

    this.$element
      .addClass('collapsing')
      .removeClass('collapse in')
      .attr('aria-expanded', false)

    this.$trigger
      .addClass('collapsed')
      .attr('aria-expanded', false)

    this.transitioning = 1

    var complete = function () {
      this.transitioning = 0
      this.$element
        .removeClass('collapsing')
        .addClass('collapse')
        .trigger('hidden.bs.collapse')
    }

    if (!$.support.transition) return complete.call(this)

    this.$element
      [dimension](0)
      .one('bsTransitionEnd', $.proxy(complete, this))
      .emulateTransitionEnd(Collapse.TRANSITION_DURATION)
  }

  Collapse.prototype.toggle = function () {
    this[this.$element.hasClass('in') ? 'hide' : 'show']()
  }

  Collapse.prototype.getParent = function () {
    return $(this.options.parent)
      .find('[data-toggle="collapse"][data-parent="' + this.options.parent + '"]')
      .each($.proxy(function (i, element) {
        var $element = $(element)
        this.addAriaAndCollapsedClass(getTargetFromTrigger($element), $element)
      }, this))
      .end()
  }

  Collapse.prototype.addAriaAndCollapsedClass = function ($element, $trigger) {
    var isOpen = $element.hasClass('in')

    $element.attr('aria-expanded', isOpen)
    $trigger
      .toggleClass('collapsed', !isOpen)
      .attr('aria-expanded', isOpen)
  }

  function getTargetFromTrigger($trigger) {
    var href
    var target = $trigger.attr('data-target')
      || (href = $trigger.attr('href')) && href.replace(/.*(?=#[^\s]+$)/, '') // strip for ie7

    return $(target)
  }


  // COLLAPSE PLUGIN DEFINITION
  // ==========================

  function Plugin(option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.collapse')
      var options = $.extend({}, Collapse.DEFAULTS, $this.data(), typeof option == 'object' && option)

      if (!data && options.toggle && /show|hide/.test(option)) options.toggle = false
      if (!data) $this.data('bs.collapse', (data = new Collapse(this, options)))
      if (typeof option == 'string') data[option]()
    })
  }

  var old = $.fn.collapse

  $.fn.collapse             = Plugin
  $.fn.collapse.Constructor = Collapse


  // COLLAPSE NO CONFLICT
  // ====================

  $.fn.collapse.noConflict = function () {
    $.fn.collapse = old
    return this
  }


  // COLLAPSE DATA-API
  // =================

  $(document).on('click.bs.collapse.data-api', '[data-toggle="collapse"]', function (e) {
    var $this   = $(this)

    if (!$this.attr('data-target')) e.preventDefault()

    var $target = getTargetFromTrigger($this)
    var data    = $target.data('bs.collapse')
    var option  = data ? 'toggle' : $this.data()

    Plugin.call($target, option)
  })

}(jQuery);
;
/* ========================================================================
 * Bootstrap: dropdown.js v3.3.7
 * http://getbootstrap.com/javascript/#dropdowns
 * ========================================================================
 * Copyright 2011-2016 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // DROPDOWN CLASS DEFINITION
  // =========================

  var backdrop = '.dropdown-backdrop'
  var toggle   = '[data-toggle="dropdown"]'
  var Dropdown = function (element) {
    $(element).on('click.bs.dropdown', this.toggle)
  }

  Dropdown.VERSION = '3.3.7'

  function getParent($this) {
    var selector = $this.attr('data-target')

    if (!selector) {
      selector = $this.attr('href')
      selector = selector && /#[A-Za-z]/.test(selector) && selector.replace(/.*(?=#[^\s]*$)/, '') // strip for ie7
    }

    var $parent = selector && $(selector)

    return $parent && $parent.length ? $parent : $this.parent()
  }

  function clearMenus(e) {
    if (e && e.which === 3) return
    $(backdrop).remove()
    $(toggle).each(function () {
      var $this         = $(this)
      var $parent       = getParent($this)
      var relatedTarget = { relatedTarget: this }

      if (!$parent.hasClass('open')) return

      if (e && e.type == 'click' && /input|textarea/i.test(e.target.tagName) && $.contains($parent[0], e.target)) return

      $parent.trigger(e = $.Event('hide.bs.dropdown', relatedTarget))

      if (e.isDefaultPrevented()) return

      $this.attr('aria-expanded', 'false')
      $parent.removeClass('open').trigger($.Event('hidden.bs.dropdown', relatedTarget))
    })
  }

  Dropdown.prototype.toggle = function (e) {
    var $this = $(this)

    if ($this.is('.disabled, :disabled')) return

    var $parent  = getParent($this)
    var isActive = $parent.hasClass('open')

    clearMenus()

    if (!isActive) {
      if ('ontouchstart' in document.documentElement && !$parent.closest('.navbar-nav').length) {
        // if mobile we use a backdrop because click events don't delegate
        $(document.createElement('div'))
          .addClass('dropdown-backdrop')
          .insertAfter($(this))
          .on('click', clearMenus)
      }

      var relatedTarget = { relatedTarget: this }
      $parent.trigger(e = $.Event('show.bs.dropdown', relatedTarget))

      if (e.isDefaultPrevented()) return

      $this
        .trigger('focus')
        .attr('aria-expanded', 'true')

      $parent
        .toggleClass('open')
        .trigger($.Event('shown.bs.dropdown', relatedTarget))
    }

    return false
  }

  Dropdown.prototype.keydown = function (e) {
    if (!/(38|40|27|32)/.test(e.which) || /input|textarea/i.test(e.target.tagName)) return

    var $this = $(this)

    e.preventDefault()
    e.stopPropagation()

    if ($this.is('.disabled, :disabled')) return

    var $parent  = getParent($this)
    var isActive = $parent.hasClass('open')

    if (!isActive && e.which != 27 || isActive && e.which == 27) {
      if (e.which == 27) $parent.find(toggle).trigger('focus')
      return $this.trigger('click')
    }

    var desc = ' li:not(.disabled):visible a'
    var $items = $parent.find('.dropdown-menu' + desc)

    if (!$items.length) return

    var index = $items.index(e.target)

    if (e.which == 38 && index > 0)                 index--         // up
    if (e.which == 40 && index < $items.length - 1) index++         // down
    if (!~index)                                    index = 0

    $items.eq(index).trigger('focus')
  }


  // DROPDOWN PLUGIN DEFINITION
  // ==========================

  function Plugin(option) {
    return this.each(function () {
      var $this = $(this)
      var data  = $this.data('bs.dropdown')

      if (!data) $this.data('bs.dropdown', (data = new Dropdown(this)))
      if (typeof option == 'string') data[option].call($this)
    })
  }

  var old = $.fn.dropdown

  $.fn.dropdown             = Plugin
  $.fn.dropdown.Constructor = Dropdown


  // DROPDOWN NO CONFLICT
  // ====================

  $.fn.dropdown.noConflict = function () {
    $.fn.dropdown = old
    return this
  }


  // APPLY TO STANDARD DROPDOWN ELEMENTS
  // ===================================

  $(document)
    .on('click.bs.dropdown.data-api', clearMenus)
    .on('click.bs.dropdown.data-api', '.dropdown form', function (e) { e.stopPropagation() })
    .on('click.bs.dropdown.data-api', toggle, Dropdown.prototype.toggle)
    .on('keydown.bs.dropdown.data-api', toggle, Dropdown.prototype.keydown)
    .on('keydown.bs.dropdown.data-api', '.dropdown-menu', Dropdown.prototype.keydown)

}(jQuery);
;
/* ========================================================================
 * Bootstrap: tab.js v3.3.7
 * http://getbootstrap.com/javascript/#tabs
 * ========================================================================
 * Copyright 2011-2016 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // TAB CLASS DEFINITION
  // ====================

  var Tab = function (element) {
    // jscs:disable requireDollarBeforejQueryAssignment
    this.element = $(element)
    // jscs:enable requireDollarBeforejQueryAssignment
  }

  Tab.VERSION = '3.3.7'

  Tab.TRANSITION_DURATION = 150

  Tab.prototype.show = function () {
    var $this    = this.element
    var $ul      = $this.closest('ul:not(.dropdown-menu)')
    var selector = $this.data('target')

    if (!selector) {
      selector = $this.attr('href')
      selector = selector && selector.replace(/.*(?=#[^\s]*$)/, '') // strip for ie7
    }

    if ($this.parent('li').hasClass('active')) return

    var $previous = $ul.find('.active:last a')
    var hideEvent = $.Event('hide.bs.tab', {
      relatedTarget: $this[0]
    })
    var showEvent = $.Event('show.bs.tab', {
      relatedTarget: $previous[0]
    })

    $previous.trigger(hideEvent)
    $this.trigger(showEvent)

    if (showEvent.isDefaultPrevented() || hideEvent.isDefaultPrevented()) return

    var $target = $(selector)

    this.activate($this.closest('li'), $ul)
    this.activate($target, $target.parent(), function () {
      $previous.trigger({
        type: 'hidden.bs.tab',
        relatedTarget: $this[0]
      })
      $this.trigger({
        type: 'shown.bs.tab',
        relatedTarget: $previous[0]
      })
    })
  }

  Tab.prototype.activate = function (element, container, callback) {
    var $active    = container.find('> .active')
    var transition = callback
      && $.support.transition
      && ($active.length && $active.hasClass('fade') || !!container.find('> .fade').length)

    function next() {
      $active
        .removeClass('active')
        .find('> .dropdown-menu > .active')
          .removeClass('active')
        .end()
        .find('[data-toggle="tab"]')
          .attr('aria-expanded', false)

      element
        .addClass('active')
        .find('[data-toggle="tab"]')
          .attr('aria-expanded', true)

      if (transition) {
        element[0].offsetWidth // reflow for transition
        element.addClass('in')
      } else {
        element.removeClass('fade')
      }

      if (element.parent('.dropdown-menu').length) {
        element
          .closest('li.dropdown')
            .addClass('active')
          .end()
          .find('[data-toggle="tab"]')
            .attr('aria-expanded', true)
      }

      callback && callback()
    }

    $active.length && transition ?
      $active
        .one('bsTransitionEnd', next)
        .emulateTransitionEnd(Tab.TRANSITION_DURATION) :
      next()

    $active.removeClass('in')
  }


  // TAB PLUGIN DEFINITION
  // =====================

  function Plugin(option) {
    return this.each(function () {
      var $this = $(this)
      var data  = $this.data('bs.tab')

      if (!data) $this.data('bs.tab', (data = new Tab(this)))
      if (typeof option == 'string') data[option]()
    })
  }

  var old = $.fn.tab

  $.fn.tab             = Plugin
  $.fn.tab.Constructor = Tab


  // TAB NO CONFLICT
  // ===============

  $.fn.tab.noConflict = function () {
    $.fn.tab = old
    return this
  }


  // TAB DATA-API
  // ============

  var clickHandler = function (e) {
    e.preventDefault()
    Plugin.call($(this), 'show')
  }

  $(document)
    .on('click.bs.tab.data-api', '[data-toggle="tab"]', clickHandler)
    .on('click.bs.tab.data-api', '[data-toggle="pill"]', clickHandler)

}(jQuery);
;
/* fix so that rows that have a ton of columns clear the first item in each row. */
jQuery(document).ready(function($) {
	var resizeTimer = null, $doc = $(document);
	function rowPolyfill() {
		var w = $doc.width();
		jQuery('.multi-columns-row > [class^="col-"]').removeClass('first-in-row');
		if (w > 1200) {
			jQuery('.multi-columns-row > .col-lg-6:nth-child(2n + 3)').addClass('first-in-row');
			jQuery('.multi-columns-row > .col-lg-4:nth-child(3n + 4)').addClass('first-in-row');
			jQuery('.multi-columns-row > .col-lg-3:nth-child(4n + 5)').addClass('first-in-row');
			jQuery('.multi-columns-row > .col-lg-2:nth-child(6n + 7)').addClass('first-in-row');
			jQuery('.multi-columns-row > .col-lg-1:nth-child(12n + 13)').addClass('first-in-row');
		} else if (w >= 992) {
			jQuery('.multi-columns-row > .col-md-6:nth-child(2n + 3)').addClass('first-in-row');
			jQuery('.multi-columns-row > .col-md-4:nth-child(3n + 4)').addClass('first-in-row');
			jQuery('.multi-columns-row > .col-md-3:nth-child(4n + 5)').addClass('first-in-row');
			jQuery('.multi-columns-row > .col-md-2:nth-child(6n + 7)').addClass('first-in-row');
			jQuery('.multi-columns-row > .col-md-1:nth-child(12n + 13)').addClass('first-in-row');
		} else if (w >= 768) {
			jQuery('.multi-columns-row > .col-sm-6:nth-child(2n + 3)').addClass('first-in-row');
			jQuery('.multi-columns-row > .col-sm-4:nth-child(3n + 4)').addClass('first-in-row');
			jQuery('.multi-columns-row > .col-sm-3:nth-child(4n + 5)').addClass('first-in-row');
			jQuery('.multi-columns-row > .col-sm-2:nth-child(6n + 7)').addClass('first-in-row');
			jQuery('.multi-columns-row > .col-sm-1:nth-child(12n + 13)').addClass('first-in-row');
		} else {
			jQuery('.multi-columns-row > .col-xs-6:nth-child(2n + 3)').addClass('first-in-row');
			jQuery('.multi-columns-row > .col-xs-4:nth-child(3n + 4)').addClass('first-in-row');
			jQuery('.multi-columns-row > .col-xs-3:nth-child(4n + 5)').addClass('first-in-row');
			jQuery('.multi-columns-row > .col-xs-2:nth-child(6n + 7)').addClass('first-in-row');
			jQuery('.multi-columns-row > .col-xs-1:nth-child(12n + 13)').addClass('first-in-row');
		}
	}	
	rowPolyfill();
	
	$(window).on('resize', function() {
		if (resizeTimer !== null) {
		clearTimeout(resizeTimer);
		}
		resizeTimer = setTimeout(rowPolyfill, 400);
	});
});;
/*! Hammer.JS - v2.0.7 - 2016-04-22
 * http://hammerjs.github.io/
 *
 * Copyright (c) 2016 Jorik Tangelder;
 * Licensed under the MIT license */
!function(a,b,c,d){"use strict";function e(a,b,c){return setTimeout(j(a,c),b)}function f(a,b,c){return Array.isArray(a)?(g(a,c[b],c),!0):!1}function g(a,b,c){var e;if(a)if(a.forEach)a.forEach(b,c);else if(a.length!==d)for(e=0;e<a.length;)b.call(c,a[e],e,a),e++;else for(e in a)a.hasOwnProperty(e)&&b.call(c,a[e],e,a)}function h(b,c,d){var e="DEPRECATED METHOD: "+c+"\n"+d+" AT \n";return function(){var c=new Error("get-stack-trace"),d=c&&c.stack?c.stack.replace(/^[^\(]+?[\n$]/gm,"").replace(/^\s+at\s+/gm,"").replace(/^Object.<anonymous>\s*\(/gm,"{anonymous}()@"):"Unknown Stack Trace",f=a.console&&(a.console.warn||a.console.log);return f&&f.call(a.console,e,d),b.apply(this,arguments)}}function i(a,b,c){var d,e=b.prototype;d=a.prototype=Object.create(e),d.constructor=a,d._super=e,c&&la(d,c)}function j(a,b){return function(){return a.apply(b,arguments)}}function k(a,b){return typeof a==oa?a.apply(b?b[0]||d:d,b):a}function l(a,b){return a===d?b:a}function m(a,b,c){g(q(b),function(b){a.addEventListener(b,c,!1)})}function n(a,b,c){g(q(b),function(b){a.removeEventListener(b,c,!1)})}function o(a,b){for(;a;){if(a==b)return!0;a=a.parentNode}return!1}function p(a,b){return a.indexOf(b)>-1}function q(a){return a.trim().split(/\s+/g)}function r(a,b,c){if(a.indexOf&&!c)return a.indexOf(b);for(var d=0;d<a.length;){if(c&&a[d][c]==b||!c&&a[d]===b)return d;d++}return-1}function s(a){return Array.prototype.slice.call(a,0)}function t(a,b,c){for(var d=[],e=[],f=0;f<a.length;){var g=b?a[f][b]:a[f];r(e,g)<0&&d.push(a[f]),e[f]=g,f++}return c&&(d=b?d.sort(function(a,c){return a[b]>c[b]}):d.sort()),d}function u(a,b){for(var c,e,f=b[0].toUpperCase()+b.slice(1),g=0;g<ma.length;){if(c=ma[g],e=c?c+f:b,e in a)return e;g++}return d}function v(){return ua++}function w(b){var c=b.ownerDocument||b;return c.defaultView||c.parentWindow||a}function x(a,b){var c=this;this.manager=a,this.callback=b,this.element=a.element,this.target=a.options.inputTarget,this.domHandler=function(b){k(a.options.enable,[a])&&c.handler(b)},this.init()}function y(a){var b,c=a.options.inputClass;return new(b=c?c:xa?M:ya?P:wa?R:L)(a,z)}function z(a,b,c){var d=c.pointers.length,e=c.changedPointers.length,f=b&Ea&&d-e===0,g=b&(Ga|Ha)&&d-e===0;c.isFirst=!!f,c.isFinal=!!g,f&&(a.session={}),c.eventType=b,A(a,c),a.emit("hammer.input",c),a.recognize(c),a.session.prevInput=c}function A(a,b){var c=a.session,d=b.pointers,e=d.length;c.firstInput||(c.firstInput=D(b)),e>1&&!c.firstMultiple?c.firstMultiple=D(b):1===e&&(c.firstMultiple=!1);var f=c.firstInput,g=c.firstMultiple,h=g?g.center:f.center,i=b.center=E(d);b.timeStamp=ra(),b.deltaTime=b.timeStamp-f.timeStamp,b.angle=I(h,i),b.distance=H(h,i),B(c,b),b.offsetDirection=G(b.deltaX,b.deltaY);var j=F(b.deltaTime,b.deltaX,b.deltaY);b.overallVelocityX=j.x,b.overallVelocityY=j.y,b.overallVelocity=qa(j.x)>qa(j.y)?j.x:j.y,b.scale=g?K(g.pointers,d):1,b.rotation=g?J(g.pointers,d):0,b.maxPointers=c.prevInput?b.pointers.length>c.prevInput.maxPointers?b.pointers.length:c.prevInput.maxPointers:b.pointers.length,C(c,b);var k=a.element;o(b.srcEvent.target,k)&&(k=b.srcEvent.target),b.target=k}function B(a,b){var c=b.center,d=a.offsetDelta||{},e=a.prevDelta||{},f=a.prevInput||{};b.eventType!==Ea&&f.eventType!==Ga||(e=a.prevDelta={x:f.deltaX||0,y:f.deltaY||0},d=a.offsetDelta={x:c.x,y:c.y}),b.deltaX=e.x+(c.x-d.x),b.deltaY=e.y+(c.y-d.y)}function C(a,b){var c,e,f,g,h=a.lastInterval||b,i=b.timeStamp-h.timeStamp;if(b.eventType!=Ha&&(i>Da||h.velocity===d)){var j=b.deltaX-h.deltaX,k=b.deltaY-h.deltaY,l=F(i,j,k);e=l.x,f=l.y,c=qa(l.x)>qa(l.y)?l.x:l.y,g=G(j,k),a.lastInterval=b}else c=h.velocity,e=h.velocityX,f=h.velocityY,g=h.direction;b.velocity=c,b.velocityX=e,b.velocityY=f,b.direction=g}function D(a){for(var b=[],c=0;c<a.pointers.length;)b[c]={clientX:pa(a.pointers[c].clientX),clientY:pa(a.pointers[c].clientY)},c++;return{timeStamp:ra(),pointers:b,center:E(b),deltaX:a.deltaX,deltaY:a.deltaY}}function E(a){var b=a.length;if(1===b)return{x:pa(a[0].clientX),y:pa(a[0].clientY)};for(var c=0,d=0,e=0;b>e;)c+=a[e].clientX,d+=a[e].clientY,e++;return{x:pa(c/b),y:pa(d/b)}}function F(a,b,c){return{x:b/a||0,y:c/a||0}}function G(a,b){return a===b?Ia:qa(a)>=qa(b)?0>a?Ja:Ka:0>b?La:Ma}function H(a,b,c){c||(c=Qa);var d=b[c[0]]-a[c[0]],e=b[c[1]]-a[c[1]];return Math.sqrt(d*d+e*e)}function I(a,b,c){c||(c=Qa);var d=b[c[0]]-a[c[0]],e=b[c[1]]-a[c[1]];return 180*Math.atan2(e,d)/Math.PI}function J(a,b){return I(b[1],b[0],Ra)+I(a[1],a[0],Ra)}function K(a,b){return H(b[0],b[1],Ra)/H(a[0],a[1],Ra)}function L(){this.evEl=Ta,this.evWin=Ua,this.pressed=!1,x.apply(this,arguments)}function M(){this.evEl=Xa,this.evWin=Ya,x.apply(this,arguments),this.store=this.manager.session.pointerEvents=[]}function N(){this.evTarget=$a,this.evWin=_a,this.started=!1,x.apply(this,arguments)}function O(a,b){var c=s(a.touches),d=s(a.changedTouches);return b&(Ga|Ha)&&(c=t(c.concat(d),"identifier",!0)),[c,d]}function P(){this.evTarget=bb,this.targetIds={},x.apply(this,arguments)}function Q(a,b){var c=s(a.touches),d=this.targetIds;if(b&(Ea|Fa)&&1===c.length)return d[c[0].identifier]=!0,[c,c];var e,f,g=s(a.changedTouches),h=[],i=this.target;if(f=c.filter(function(a){return o(a.target,i)}),b===Ea)for(e=0;e<f.length;)d[f[e].identifier]=!0,e++;for(e=0;e<g.length;)d[g[e].identifier]&&h.push(g[e]),b&(Ga|Ha)&&delete d[g[e].identifier],e++;return h.length?[t(f.concat(h),"identifier",!0),h]:void 0}function R(){x.apply(this,arguments);var a=j(this.handler,this);this.touch=new P(this.manager,a),this.mouse=new L(this.manager,a),this.primaryTouch=null,this.lastTouches=[]}function S(a,b){a&Ea?(this.primaryTouch=b.changedPointers[0].identifier,T.call(this,b)):a&(Ga|Ha)&&T.call(this,b)}function T(a){var b=a.changedPointers[0];if(b.identifier===this.primaryTouch){var c={x:b.clientX,y:b.clientY};this.lastTouches.push(c);var d=this.lastTouches,e=function(){var a=d.indexOf(c);a>-1&&d.splice(a,1)};setTimeout(e,cb)}}function U(a){for(var b=a.srcEvent.clientX,c=a.srcEvent.clientY,d=0;d<this.lastTouches.length;d++){var e=this.lastTouches[d],f=Math.abs(b-e.x),g=Math.abs(c-e.y);if(db>=f&&db>=g)return!0}return!1}function V(a,b){this.manager=a,this.set(b)}function W(a){if(p(a,jb))return jb;var b=p(a,kb),c=p(a,lb);return b&&c?jb:b||c?b?kb:lb:p(a,ib)?ib:hb}function X(){if(!fb)return!1;var b={},c=a.CSS&&a.CSS.supports;return["auto","manipulation","pan-y","pan-x","pan-x pan-y","none"].forEach(function(d){b[d]=c?a.CSS.supports("touch-action",d):!0}),b}function Y(a){this.options=la({},this.defaults,a||{}),this.id=v(),this.manager=null,this.options.enable=l(this.options.enable,!0),this.state=nb,this.simultaneous={},this.requireFail=[]}function Z(a){return a&sb?"cancel":a&qb?"end":a&pb?"move":a&ob?"start":""}function $(a){return a==Ma?"down":a==La?"up":a==Ja?"left":a==Ka?"right":""}function _(a,b){var c=b.manager;return c?c.get(a):a}function aa(){Y.apply(this,arguments)}function ba(){aa.apply(this,arguments),this.pX=null,this.pY=null}function ca(){aa.apply(this,arguments)}function da(){Y.apply(this,arguments),this._timer=null,this._input=null}function ea(){aa.apply(this,arguments)}function fa(){aa.apply(this,arguments)}function ga(){Y.apply(this,arguments),this.pTime=!1,this.pCenter=!1,this._timer=null,this._input=null,this.count=0}function ha(a,b){return b=b||{},b.recognizers=l(b.recognizers,ha.defaults.preset),new ia(a,b)}function ia(a,b){this.options=la({},ha.defaults,b||{}),this.options.inputTarget=this.options.inputTarget||a,this.handlers={},this.session={},this.recognizers=[],this.oldCssProps={},this.element=a,this.input=y(this),this.touchAction=new V(this,this.options.touchAction),ja(this,!0),g(this.options.recognizers,function(a){var b=this.add(new a[0](a[1]));a[2]&&b.recognizeWith(a[2]),a[3]&&b.requireFailure(a[3])},this)}function ja(a,b){var c=a.element;if(c.style){var d;g(a.options.cssProps,function(e,f){d=u(c.style,f),b?(a.oldCssProps[d]=c.style[d],c.style[d]=e):c.style[d]=a.oldCssProps[d]||""}),b||(a.oldCssProps={})}}function ka(a,c){var d=b.createEvent("Event");d.initEvent(a,!0,!0),d.gesture=c,c.target.dispatchEvent(d)}var la,ma=["","webkit","Moz","MS","ms","o"],na=b.createElement("div"),oa="function",pa=Math.round,qa=Math.abs,ra=Date.now;la="function"!=typeof Object.assign?function(a){if(a===d||null===a)throw new TypeError("Cannot convert undefined or null to object");for(var b=Object(a),c=1;c<arguments.length;c++){var e=arguments[c];if(e!==d&&null!==e)for(var f in e)e.hasOwnProperty(f)&&(b[f]=e[f])}return b}:Object.assign;var sa=h(function(a,b,c){for(var e=Object.keys(b),f=0;f<e.length;)(!c||c&&a[e[f]]===d)&&(a[e[f]]=b[e[f]]),f++;return a},"extend","Use `assign`."),ta=h(function(a,b){return sa(a,b,!0)},"merge","Use `assign`."),ua=1,va=/mobile|tablet|ip(ad|hone|od)|android/i,wa="ontouchstart"in a,xa=u(a,"PointerEvent")!==d,ya=wa&&va.test(navigator.userAgent),za="touch",Aa="pen",Ba="mouse",Ca="kinect",Da=25,Ea=1,Fa=2,Ga=4,Ha=8,Ia=1,Ja=2,Ka=4,La=8,Ma=16,Na=Ja|Ka,Oa=La|Ma,Pa=Na|Oa,Qa=["x","y"],Ra=["clientX","clientY"];x.prototype={handler:function(){},init:function(){this.evEl&&m(this.element,this.evEl,this.domHandler),this.evTarget&&m(this.target,this.evTarget,this.domHandler),this.evWin&&m(w(this.element),this.evWin,this.domHandler)},destroy:function(){this.evEl&&n(this.element,this.evEl,this.domHandler),this.evTarget&&n(this.target,this.evTarget,this.domHandler),this.evWin&&n(w(this.element),this.evWin,this.domHandler)}};var Sa={mousedown:Ea,mousemove:Fa,mouseup:Ga},Ta="mousedown",Ua="mousemove mouseup";i(L,x,{handler:function(a){var b=Sa[a.type];b&Ea&&0===a.button&&(this.pressed=!0),b&Fa&&1!==a.which&&(b=Ga),this.pressed&&(b&Ga&&(this.pressed=!1),this.callback(this.manager,b,{pointers:[a],changedPointers:[a],pointerType:Ba,srcEvent:a}))}});var Va={pointerdown:Ea,pointermove:Fa,pointerup:Ga,pointercancel:Ha,pointerout:Ha},Wa={2:za,3:Aa,4:Ba,5:Ca},Xa="pointerdown",Ya="pointermove pointerup pointercancel";a.MSPointerEvent&&!a.PointerEvent&&(Xa="MSPointerDown",Ya="MSPointerMove MSPointerUp MSPointerCancel"),i(M,x,{handler:function(a){var b=this.store,c=!1,d=a.type.toLowerCase().replace("ms",""),e=Va[d],f=Wa[a.pointerType]||a.pointerType,g=f==za,h=r(b,a.pointerId,"pointerId");e&Ea&&(0===a.button||g)?0>h&&(b.push(a),h=b.length-1):e&(Ga|Ha)&&(c=!0),0>h||(b[h]=a,this.callback(this.manager,e,{pointers:b,changedPointers:[a],pointerType:f,srcEvent:a}),c&&b.splice(h,1))}});var Za={touchstart:Ea,touchmove:Fa,touchend:Ga,touchcancel:Ha},$a="touchstart",_a="touchstart touchmove touchend touchcancel";i(N,x,{handler:function(a){var b=Za[a.type];if(b===Ea&&(this.started=!0),this.started){var c=O.call(this,a,b);b&(Ga|Ha)&&c[0].length-c[1].length===0&&(this.started=!1),this.callback(this.manager,b,{pointers:c[0],changedPointers:c[1],pointerType:za,srcEvent:a})}}});var ab={touchstart:Ea,touchmove:Fa,touchend:Ga,touchcancel:Ha},bb="touchstart touchmove touchend touchcancel";i(P,x,{handler:function(a){var b=ab[a.type],c=Q.call(this,a,b);c&&this.callback(this.manager,b,{pointers:c[0],changedPointers:c[1],pointerType:za,srcEvent:a})}});var cb=2500,db=25;i(R,x,{handler:function(a,b,c){var d=c.pointerType==za,e=c.pointerType==Ba;if(!(e&&c.sourceCapabilities&&c.sourceCapabilities.firesTouchEvents)){if(d)S.call(this,b,c);else if(e&&U.call(this,c))return;this.callback(a,b,c)}},destroy:function(){this.touch.destroy(),this.mouse.destroy()}});var eb=u(na.style,"touchAction"),fb=eb!==d,gb="compute",hb="auto",ib="manipulation",jb="none",kb="pan-x",lb="pan-y",mb=X();V.prototype={set:function(a){a==gb&&(a=this.compute()),fb&&this.manager.element.style&&mb[a]&&(this.manager.element.style[eb]=a),this.actions=a.toLowerCase().trim()},update:function(){this.set(this.manager.options.touchAction)},compute:function(){var a=[];return g(this.manager.recognizers,function(b){k(b.options.enable,[b])&&(a=a.concat(b.getTouchAction()))}),W(a.join(" "))},preventDefaults:function(a){var b=a.srcEvent,c=a.offsetDirection;if(this.manager.session.prevented)return void b.preventDefault();var d=this.actions,e=p(d,jb)&&!mb[jb],f=p(d,lb)&&!mb[lb],g=p(d,kb)&&!mb[kb];if(e){var h=1===a.pointers.length,i=a.distance<2,j=a.deltaTime<250;if(h&&i&&j)return}return g&&f?void 0:e||f&&c&Na||g&&c&Oa?this.preventSrc(b):void 0},preventSrc:function(a){this.manager.session.prevented=!0,a.preventDefault()}};var nb=1,ob=2,pb=4,qb=8,rb=qb,sb=16,tb=32;Y.prototype={defaults:{},set:function(a){return la(this.options,a),this.manager&&this.manager.touchAction.update(),this},recognizeWith:function(a){if(f(a,"recognizeWith",this))return this;var b=this.simultaneous;return a=_(a,this),b[a.id]||(b[a.id]=a,a.recognizeWith(this)),this},dropRecognizeWith:function(a){return f(a,"dropRecognizeWith",this)?this:(a=_(a,this),delete this.simultaneous[a.id],this)},requireFailure:function(a){if(f(a,"requireFailure",this))return this;var b=this.requireFail;return a=_(a,this),-1===r(b,a)&&(b.push(a),a.requireFailure(this)),this},dropRequireFailure:function(a){if(f(a,"dropRequireFailure",this))return this;a=_(a,this);var b=r(this.requireFail,a);return b>-1&&this.requireFail.splice(b,1),this},hasRequireFailures:function(){return this.requireFail.length>0},canRecognizeWith:function(a){return!!this.simultaneous[a.id]},emit:function(a){function b(b){c.manager.emit(b,a)}var c=this,d=this.state;qb>d&&b(c.options.event+Z(d)),b(c.options.event),a.additionalEvent&&b(a.additionalEvent),d>=qb&&b(c.options.event+Z(d))},tryEmit:function(a){return this.canEmit()?this.emit(a):void(this.state=tb)},canEmit:function(){for(var a=0;a<this.requireFail.length;){if(!(this.requireFail[a].state&(tb|nb)))return!1;a++}return!0},recognize:function(a){var b=la({},a);return k(this.options.enable,[this,b])?(this.state&(rb|sb|tb)&&(this.state=nb),this.state=this.process(b),void(this.state&(ob|pb|qb|sb)&&this.tryEmit(b))):(this.reset(),void(this.state=tb))},process:function(a){},getTouchAction:function(){},reset:function(){}},i(aa,Y,{defaults:{pointers:1},attrTest:function(a){var b=this.options.pointers;return 0===b||a.pointers.length===b},process:function(a){var b=this.state,c=a.eventType,d=b&(ob|pb),e=this.attrTest(a);return d&&(c&Ha||!e)?b|sb:d||e?c&Ga?b|qb:b&ob?b|pb:ob:tb}}),i(ba,aa,{defaults:{event:"pan",threshold:10,pointers:1,direction:Pa},getTouchAction:function(){var a=this.options.direction,b=[];return a&Na&&b.push(lb),a&Oa&&b.push(kb),b},directionTest:function(a){var b=this.options,c=!0,d=a.distance,e=a.direction,f=a.deltaX,g=a.deltaY;return e&b.direction||(b.direction&Na?(e=0===f?Ia:0>f?Ja:Ka,c=f!=this.pX,d=Math.abs(a.deltaX)):(e=0===g?Ia:0>g?La:Ma,c=g!=this.pY,d=Math.abs(a.deltaY))),a.direction=e,c&&d>b.threshold&&e&b.direction},attrTest:function(a){return aa.prototype.attrTest.call(this,a)&&(this.state&ob||!(this.state&ob)&&this.directionTest(a))},emit:function(a){this.pX=a.deltaX,this.pY=a.deltaY;var b=$(a.direction);b&&(a.additionalEvent=this.options.event+b),this._super.emit.call(this,a)}}),i(ca,aa,{defaults:{event:"pinch",threshold:0,pointers:2},getTouchAction:function(){return[jb]},attrTest:function(a){return this._super.attrTest.call(this,a)&&(Math.abs(a.scale-1)>this.options.threshold||this.state&ob)},emit:function(a){if(1!==a.scale){var b=a.scale<1?"in":"out";a.additionalEvent=this.options.event+b}this._super.emit.call(this,a)}}),i(da,Y,{defaults:{event:"press",pointers:1,time:251,threshold:9},getTouchAction:function(){return[hb]},process:function(a){var b=this.options,c=a.pointers.length===b.pointers,d=a.distance<b.threshold,f=a.deltaTime>b.time;if(this._input=a,!d||!c||a.eventType&(Ga|Ha)&&!f)this.reset();else if(a.eventType&Ea)this.reset(),this._timer=e(function(){this.state=rb,this.tryEmit()},b.time,this);else if(a.eventType&Ga)return rb;return tb},reset:function(){clearTimeout(this._timer)},emit:function(a){this.state===rb&&(a&&a.eventType&Ga?this.manager.emit(this.options.event+"up",a):(this._input.timeStamp=ra(),this.manager.emit(this.options.event,this._input)))}}),i(ea,aa,{defaults:{event:"rotate",threshold:0,pointers:2},getTouchAction:function(){return[jb]},attrTest:function(a){return this._super.attrTest.call(this,a)&&(Math.abs(a.rotation)>this.options.threshold||this.state&ob)}}),i(fa,aa,{defaults:{event:"swipe",threshold:10,velocity:.3,direction:Na|Oa,pointers:1},getTouchAction:function(){return ba.prototype.getTouchAction.call(this)},attrTest:function(a){var b,c=this.options.direction;return c&(Na|Oa)?b=a.overallVelocity:c&Na?b=a.overallVelocityX:c&Oa&&(b=a.overallVelocityY),this._super.attrTest.call(this,a)&&c&a.offsetDirection&&a.distance>this.options.threshold&&a.maxPointers==this.options.pointers&&qa(b)>this.options.velocity&&a.eventType&Ga},emit:function(a){var b=$(a.offsetDirection);b&&this.manager.emit(this.options.event+b,a),this.manager.emit(this.options.event,a)}}),i(ga,Y,{defaults:{event:"tap",pointers:1,taps:1,interval:300,time:250,threshold:9,posThreshold:10},getTouchAction:function(){return[ib]},process:function(a){var b=this.options,c=a.pointers.length===b.pointers,d=a.distance<b.threshold,f=a.deltaTime<b.time;if(this.reset(),a.eventType&Ea&&0===this.count)return this.failTimeout();if(d&&f&&c){if(a.eventType!=Ga)return this.failTimeout();var g=this.pTime?a.timeStamp-this.pTime<b.interval:!0,h=!this.pCenter||H(this.pCenter,a.center)<b.posThreshold;this.pTime=a.timeStamp,this.pCenter=a.center,h&&g?this.count+=1:this.count=1,this._input=a;var i=this.count%b.taps;if(0===i)return this.hasRequireFailures()?(this._timer=e(function(){this.state=rb,this.tryEmit()},b.interval,this),ob):rb}return tb},failTimeout:function(){return this._timer=e(function(){this.state=tb},this.options.interval,this),tb},reset:function(){clearTimeout(this._timer)},emit:function(){this.state==rb&&(this._input.tapCount=this.count,this.manager.emit(this.options.event,this._input))}}),ha.VERSION="2.0.7",ha.defaults={domEvents:!1,touchAction:gb,enable:!0,inputTarget:null,inputClass:null,preset:[[ea,{enable:!1}],[ca,{enable:!1},["rotate"]],[fa,{direction:Na}],[ba,{direction:Na},["swipe"]],[ga],[ga,{event:"doubletap",taps:2},["tap"]],[da]],cssProps:{userSelect:"none",touchSelect:"none",touchCallout:"none",contentZooming:"none",userDrag:"none",tapHighlightColor:"rgba(0,0,0,0)"}};var ub=1,vb=2;ia.prototype={set:function(a){return la(this.options,a),a.touchAction&&this.touchAction.update(),a.inputTarget&&(this.input.destroy(),this.input.target=a.inputTarget,this.input.init()),this},stop:function(a){this.session.stopped=a?vb:ub},recognize:function(a){var b=this.session;if(!b.stopped){this.touchAction.preventDefaults(a);var c,d=this.recognizers,e=b.curRecognizer;(!e||e&&e.state&rb)&&(e=b.curRecognizer=null);for(var f=0;f<d.length;)c=d[f],b.stopped===vb||e&&c!=e&&!c.canRecognizeWith(e)?c.reset():c.recognize(a),!e&&c.state&(ob|pb|qb)&&(e=b.curRecognizer=c),f++}},get:function(a){if(a instanceof Y)return a;for(var b=this.recognizers,c=0;c<b.length;c++)if(b[c].options.event==a)return b[c];return null},add:function(a){if(f(a,"add",this))return this;var b=this.get(a.options.event);return b&&this.remove(b),this.recognizers.push(a),a.manager=this,this.touchAction.update(),a},remove:function(a){if(f(a,"remove",this))return this;if(a=this.get(a)){var b=this.recognizers,c=r(b,a);-1!==c&&(b.splice(c,1),this.touchAction.update())}return this},on:function(a,b){if(a!==d&&b!==d){var c=this.handlers;return g(q(a),function(a){c[a]=c[a]||[],c[a].push(b)}),this}},off:function(a,b){if(a!==d){var c=this.handlers;return g(q(a),function(a){b?c[a]&&c[a].splice(r(c[a],b),1):delete c[a]}),this}},emit:function(a,b){this.options.domEvents&&ka(a,b);var c=this.handlers[a]&&this.handlers[a].slice();if(c&&c.length){b.type=a,b.preventDefault=function(){b.srcEvent.preventDefault()};for(var d=0;d<c.length;)c[d](b),d++}},destroy:function(){this.element&&ja(this,!1),this.handlers={},this.session={},this.input.destroy(),this.element=null}},la(ha,{INPUT_START:Ea,INPUT_MOVE:Fa,INPUT_END:Ga,INPUT_CANCEL:Ha,STATE_POSSIBLE:nb,STATE_BEGAN:ob,STATE_CHANGED:pb,STATE_ENDED:qb,STATE_RECOGNIZED:rb,STATE_CANCELLED:sb,STATE_FAILED:tb,DIRECTION_NONE:Ia,DIRECTION_LEFT:Ja,DIRECTION_RIGHT:Ka,DIRECTION_UP:La,DIRECTION_DOWN:Ma,DIRECTION_HORIZONTAL:Na,DIRECTION_VERTICAL:Oa,DIRECTION_ALL:Pa,Manager:ia,Input:x,TouchAction:V,TouchInput:P,MouseInput:L,PointerEventInput:M,TouchMouseInput:R,SingleTouchInput:N,Recognizer:Y,AttrRecognizer:aa,Tap:ga,Pan:ba,Swipe:fa,Pinch:ca,Rotate:ea,Press:da,on:m,off:n,each:g,merge:ta,extend:sa,assign:la,inherit:i,bindFn:j,prefixed:u});var wb="undefined"!=typeof a?a:"undefined"!=typeof self?self:{};wb.Hammer=ha,"function"==typeof define&&define.amd?define(function(){return ha}):"undefined"!=typeof module&&module.exports?module.exports=ha:a[c]=ha}(window,document,"Hammer");

(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var $, Context, Transparency, _, helpers,
  indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

_ = require('../lib/lodash.js');

helpers = require('./helpers');

Context = require('./context');

Transparency = {};

Transparency.render = function(context, models, directives, options) {
  var base, log;
  if (models == null) {
    models = [];
  }
  if (directives == null) {
    directives = {};
  }
  if (options == null) {
    options = {};
  }
  log = options.debug && console ? helpers.consoleLogger : helpers.nullLogger;
  log("Transparency.render:", context, models, directives, options);
  if (!context) {
    return;
  }
  if (!_.isArray(models)) {
    models = [models];
  }
  context = (base = helpers.data(context)).context || (base.context = new Context(context, Transparency));
  return context.render(models, directives, options).el;
};

Transparency.matcher = function(element, key) {
  return element.el.id === key || indexOf.call(element.classNames, key) >= 0 || element.el.name === key || element.el.getAttribute('data-bind') === key;
};

Transparency.clone = function(node) {
  return $(node).clone()[0];
};

Transparency.jQueryPlugin = helpers.chainable(function(models, directives, options) {
  var context, i, len, results;
  results = [];
  for (i = 0, len = this.length; i < len; i++) {
    context = this[i];
    results.push(Transparency.render(context, models, directives, options));
  }
  return results;
});

if ((typeof jQuery !== "undefined" && jQuery !== null) || (typeof Zepto !== "undefined" && Zepto !== null)) {
  $ = jQuery || Zepto;
  if ($ != null) {
    $.fn.render = Transparency.jQueryPlugin;
  }
}

if (typeof module !== "undefined" && module !== null ? module.exports : void 0) {
  module.exports = Transparency;
}

if (typeof window !== "undefined" && window !== null) {
  window.Transparency = Transparency;
}

if (typeof define !== "undefined" && define !== null ? define.amd : void 0) {
  define(function() {
    return Transparency;
  });
}

},{"../lib/lodash.js":7,"./context":3,"./helpers":5}],2:[function(require,module,exports){
var Attribute, AttributeFactory, BooleanAttribute, Class, Html, Text, _, helpers,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

_ = require('../lib/lodash');

helpers = require('./helpers');

module.exports = AttributeFactory = {
  Attributes: {},
  createAttribute: function(element, name) {
    var Attr;
    Attr = AttributeFactory.Attributes[name] || Attribute;
    return new Attr(element, name);
  }
};

Attribute = (function() {
  function Attribute(el1, name1) {
    this.el = el1;
    this.name = name1;
    this.templateValue = this.el.getAttribute(this.name) || '';
  }

  Attribute.prototype.set = function(value) {
    this.el[this.name] = value;
    return this.el.setAttribute(this.name, value.toString());
  };

  return Attribute;

})();

BooleanAttribute = (function(superClass) {
  var BOOLEAN_ATTRIBUTES, i, len, name;

  extend(BooleanAttribute, superClass);

  BOOLEAN_ATTRIBUTES = ['hidden', 'async', 'defer', 'autofocus', 'formnovalidate', 'disabled', 'autofocus', 'formnovalidate', 'multiple', 'readonly', 'required', 'checked', 'scoped', 'reversed', 'selected', 'loop', 'muted', 'autoplay', 'controls', 'seamless', 'default', 'ismap', 'novalidate', 'open', 'typemustmatch', 'truespeed'];

  for (i = 0, len = BOOLEAN_ATTRIBUTES.length; i < len; i++) {
    name = BOOLEAN_ATTRIBUTES[i];
    AttributeFactory.Attributes[name] = BooleanAttribute;
  }

  function BooleanAttribute(el1, name1) {
    this.el = el1;
    this.name = name1;
    this.templateValue = this.el.getAttribute(this.name) || false;
  }

  BooleanAttribute.prototype.set = function(value) {
    this.el[this.name] = value;
    if (value) {
      return this.el.setAttribute(this.name, this.name);
    } else {
      return this.el.removeAttribute(this.name);
    }
  };

  return BooleanAttribute;

})(Attribute);

Text = (function(superClass) {
  extend(Text, superClass);

  AttributeFactory.Attributes['text'] = Text;

  function Text(el1, name1) {
    var child;
    this.el = el1;
    this.name = name1;
    this.templateValue = ((function() {
      var i, len, ref, results;
      ref = this.el.childNodes;
      results = [];
      for (i = 0, len = ref.length; i < len; i++) {
        child = ref[i];
        if (child.nodeType === helpers.TEXT_NODE) {
          results.push(child.nodeValue);
        }
      }
      return results;
    }).call(this)).join('');
    this.children = _.toArray(this.el.children);
    if (!(this.textNode = this.el.firstChild)) {
      this.el.appendChild(this.textNode = this.el.ownerDocument.createTextNode(''));
    } else if (this.textNode.nodeType !== helpers.TEXT_NODE) {
      this.textNode = this.el.insertBefore(this.el.ownerDocument.createTextNode(''), this.textNode);
    }
  }

  Text.prototype.set = function(text) {
    var child, i, len, ref, results;
    while (child = this.el.firstChild) {
      this.el.removeChild(child);
    }
    this.textNode.nodeValue = text;
    this.el.appendChild(this.textNode);
    ref = this.children;
    results = [];
    for (i = 0, len = ref.length; i < len; i++) {
      child = ref[i];
      results.push(this.el.appendChild(child));
    }
    return results;
  };

  return Text;

})(Attribute);

Html = (function(superClass) {
  extend(Html, superClass);

  AttributeFactory.Attributes['html'] = Html;

  function Html(el1) {
    this.el = el1;
    this.templateValue = '';
    this.children = _.toArray(this.el.children);
  }

  Html.prototype.set = function(html) {
    var child, i, len, ref, results;
    while (child = this.el.firstChild) {
      this.el.removeChild(child);
    }
    this.el.innerHTML = html + this.templateValue;
    ref = this.children;
    results = [];
    for (i = 0, len = ref.length; i < len; i++) {
      child = ref[i];
      results.push(this.el.appendChild(child));
    }
    return results;
  };

  return Html;

})(Attribute);

Class = (function(superClass) {
  extend(Class, superClass);

  AttributeFactory.Attributes['class'] = Class;

  function Class(el) {
    Class.__super__.constructor.call(this, el, 'class');
  }

  return Class;

})(Attribute);

},{"../lib/lodash":7,"./helpers":5}],3:[function(require,module,exports){
var Context, Instance, after, before, chainable, cloneNode, ref;

ref = require('./helpers'), before = ref.before, after = ref.after, chainable = ref.chainable, cloneNode = ref.cloneNode;

Instance = require('./instance');

module.exports = Context = (function() {
  var attach, detach;

  detach = chainable(function() {
    this.parent = this.el.parentNode;
    if (this.parent) {
      this.nextSibling = this.el.nextSibling;
      return this.parent.removeChild(this.el);
    }
  });

  attach = chainable(function() {
    if (this.parent) {
      if (this.nextSibling) {
        return this.parent.insertBefore(this.el, this.nextSibling);
      } else {
        return this.parent.appendChild(this.el);
      }
    }
  });

  function Context(el, Transparency) {
    this.el = el;
    this.Transparency = Transparency;
    this.template = cloneNode(this.el);
    this.instances = [new Instance(this.el, this.Transparency)];
    this.instanceCache = [];
  }

  Context.prototype.render = before(detach)(after(attach)(chainable(function(models, directives, options) {
    var children, i, index, instance, len, model, results;
    while (models.length < this.instances.length) {
      this.instanceCache.push(this.instances.pop().remove());
    }
    while (models.length > this.instances.length) {
      instance = this.instanceCache.pop() || new Instance(cloneNode(this.template), this.Transparency);
      this.instances.push(instance.appendTo(this.el));
    }
    results = [];
    for (index = i = 0, len = models.length; i < len; index = ++i) {
      model = models[index];
      instance = this.instances[index];
      children = [];
      results.push(instance.prepare(model, children).renderValues(model, children).renderDirectives(model, index, directives).renderChildren(model, children, directives, options));
    }
    return results;
  })));

  return Context;

})();

},{"./helpers":5,"./instance":6}],4:[function(require,module,exports){
var AttributeFactory, Checkbox, Element, ElementFactory, Input, Radio, Select, TextArea, VoidElement, _, helpers,
  hasProp = {}.hasOwnProperty,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

_ = require('../lib/lodash.js');

helpers = require('./helpers');

AttributeFactory = require('./attributeFactory');

module.exports = ElementFactory = {
  Elements: {
    input: {}
  },
  createElement: function(el) {
    var El, name;
    if ('input' === (name = el.nodeName.toLowerCase())) {
      El = ElementFactory.Elements[name][el.type.toLowerCase()] || Input;
    } else {
      El = ElementFactory.Elements[name] || Element;
    }
    return new El(el);
  }
};

Element = (function() {
  function Element(el1) {
    this.el = el1;
    this.attributes = {};
    this.childNodes = _.toArray(this.el.childNodes);
    this.nodeName = this.el.nodeName.toLowerCase();
    this.classNames = this.el.className.split(' ');
    this.originalAttributes = {};
  }

  Element.prototype.empty = function() {
    var child;
    while (child = this.el.firstChild) {
      this.el.removeChild(child);
    }
    return this;
  };

  Element.prototype.reset = function() {
    var attribute, name, ref, results;
    ref = this.attributes;
    results = [];
    for (name in ref) {
      attribute = ref[name];
      results.push(attribute.set(attribute.templateValue));
    }
    return results;
  };

  Element.prototype.render = function(value) {
    return this.attr('text', value);
  };

  Element.prototype.attr = function(name, value) {
    var attribute, base;
    attribute = (base = this.attributes)[name] || (base[name] = AttributeFactory.createAttribute(this.el, name, value));
    if (value != null) {
      attribute.set(value);
    }
    return attribute;
  };

  Element.prototype.renderDirectives = function(model, index, attributes) {
    var directive, name, results, value;
    results = [];
    for (name in attributes) {
      if (!hasProp.call(attributes, name)) continue;
      directive = attributes[name];
      if (!(typeof directive === 'function')) {
        continue;
      }
      value = directive.call(model, {
        element: this.el,
        index: index,
        value: this.attr(name).templateValue
      });
      if (value != null) {
        results.push(this.attr(name, value));
      } else {
        results.push(void 0);
      }
    }
    return results;
  };

  return Element;

})();

Select = (function(superClass) {
  extend(Select, superClass);

  ElementFactory.Elements['select'] = Select;

  function Select(el) {
    Select.__super__.constructor.call(this, el);
    this.elements = helpers.getElements(el);
  }

  Select.prototype.render = function(value) {
    var i, len, option, ref, results;
    value = value.toString();
    ref = this.elements;
    results = [];
    for (i = 0, len = ref.length; i < len; i++) {
      option = ref[i];
      if (option.nodeName === 'option') {
        results.push(option.attr('selected', option.el.value === value));
      }
    }
    return results;
  };

  return Select;

})(Element);

VoidElement = (function(superClass) {
  var VOID_ELEMENTS, i, len, nodeName;

  extend(VoidElement, superClass);

  function VoidElement() {
    return VoidElement.__super__.constructor.apply(this, arguments);
  }

  VOID_ELEMENTS = ['area', 'base', 'br', 'col', 'command', 'embed', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr'];

  for (i = 0, len = VOID_ELEMENTS.length; i < len; i++) {
    nodeName = VOID_ELEMENTS[i];
    ElementFactory.Elements[nodeName] = VoidElement;
  }

  VoidElement.prototype.attr = function(name, value) {
    if (name !== 'text' && name !== 'html') {
      return VoidElement.__super__.attr.call(this, name, value);
    }
  };

  return VoidElement;

})(Element);

Input = (function(superClass) {
  extend(Input, superClass);

  function Input() {
    return Input.__super__.constructor.apply(this, arguments);
  }

  Input.prototype.render = function(value) {
    return this.attr('value', value);
  };

  return Input;

})(VoidElement);

TextArea = (function(superClass) {
  extend(TextArea, superClass);

  function TextArea() {
    return TextArea.__super__.constructor.apply(this, arguments);
  }

  ElementFactory.Elements['textarea'] = TextArea;

  return TextArea;

})(Input);

Checkbox = (function(superClass) {
  extend(Checkbox, superClass);

  function Checkbox() {
    return Checkbox.__super__.constructor.apply(this, arguments);
  }

  ElementFactory.Elements['input']['checkbox'] = Checkbox;

  Checkbox.prototype.render = function(value) {
    return this.attr('checked', Boolean(value));
  };

  return Checkbox;

})(Input);

Radio = (function(superClass) {
  extend(Radio, superClass);

  function Radio() {
    return Radio.__super__.constructor.apply(this, arguments);
  }

  ElementFactory.Elements['input']['radio'] = Radio;

  return Radio;

})(Checkbox);

},{"../lib/lodash.js":7,"./attributeFactory":2,"./helpers":5}],5:[function(require,module,exports){
var ElementFactory, _getElements, expando, html5Clone;

ElementFactory = require('./elementFactory');

exports.before = function(decorator) {
  return function(method) {
    return function() {
      decorator.apply(this, arguments);
      return method.apply(this, arguments);
    };
  };
};

exports.after = function(decorator) {
  return function(method) {
    return function() {
      method.apply(this, arguments);
      return decorator.apply(this, arguments);
    };
  };
};

exports.chainable = exports.after(function() {
  return this;
});

exports.onlyWith$ = function(fn) {
  if ((typeof jQuery !== "undefined" && jQuery !== null) || (typeof Zepto !== "undefined" && Zepto !== null)) {
    return (function($) {
      return fn(arguments);
    })(jQuery || Zepto);
  }
};

exports.getElements = function(el) {
  var elements;
  elements = [];
  _getElements(el, elements);
  return elements;
};

_getElements = function(template, elements) {
  var child, results;
  child = template.firstChild;
  results = [];
  while (child) {
    if (child.nodeType === exports.ELEMENT_NODE) {
      elements.push(new ElementFactory.createElement(child));
      _getElements(child, elements);
    }
    results.push(child = child.nextSibling);
  }
  return results;
};

exports.ELEMENT_NODE = 1;

exports.TEXT_NODE = 3;

html5Clone = function() {
  return document.createElement('nav').cloneNode(true).outerHTML !== '<:nav></:nav>';
};

exports.cloneNode = (typeof document === "undefined" || document === null) || html5Clone() ? function(node) {
  return node.cloneNode(true);
} : function(node) {
  var cloned, element, i, len, ref;
  cloned = Transparency.clone(node);
  if (cloned.nodeType === exports.ELEMENT_NODE) {
    cloned.removeAttribute(expando);
    ref = cloned.getElementsByTagName('*');
    for (i = 0, len = ref.length; i < len; i++) {
      element = ref[i];
      element.removeAttribute(expando);
    }
  }
  return cloned;
};

expando = 'transparency';

exports.data = function(element) {
  return element[expando] || (element[expando] = {});
};

exports.nullLogger = function() {};

exports.consoleLogger = function() {
  return console.log(arguments);
};

exports.log = exports.nullLogger;

},{"./elementFactory":4}],6:[function(require,module,exports){
var Instance, _, chainable, helpers,
  hasProp = {}.hasOwnProperty;

_ = require('../lib/lodash.js');

chainable = (helpers = require('./helpers')).chainable;

module.exports = Instance = (function() {
  function Instance(template, Transparency) {
    this.Transparency = Transparency;
    this.queryCache = {};
    this.childNodes = _.toArray(template.childNodes);
    this.elements = helpers.getElements(template);
  }

  Instance.prototype.remove = chainable(function() {
    var i, len, node, ref, results;
    ref = this.childNodes;
    results = [];
    for (i = 0, len = ref.length; i < len; i++) {
      node = ref[i];
      results.push(node.parentNode.removeChild(node));
    }
    return results;
  });

  Instance.prototype.appendTo = chainable(function(parent) {
    var i, len, node, ref, results;
    ref = this.childNodes;
    results = [];
    for (i = 0, len = ref.length; i < len; i++) {
      node = ref[i];
      results.push(parent.appendChild(node));
    }
    return results;
  });

  Instance.prototype.prepare = chainable(function(model) {
    var element, i, len, ref, results;
    ref = this.elements;
    results = [];
    for (i = 0, len = ref.length; i < len; i++) {
      element = ref[i];
      element.reset();
      results.push(helpers.data(element.el).model = model);
    }
    return results;
  });

  Instance.prototype.renderValues = chainable(function(model, children) {
    var element, key, results, value;
    if (_.isElement(model) && (element = this.elements[0])) {
      return element.empty().el.appendChild(model);
    } else if (typeof model === 'object') {
      results = [];
      for (key in model) {
        if (!hasProp.call(model, key)) continue;
        value = model[key];
        if (value != null) {
          if (_.isString(value) || _.isNumber(value) || _.isBoolean(value) || _.isDate(value)) {
            results.push((function() {
              var i, len, ref, results1;
              ref = this.matchingElements(key);
              results1 = [];
              for (i = 0, len = ref.length; i < len; i++) {
                element = ref[i];
                results1.push(element.render(value));
              }
              return results1;
            }).call(this));
          } else if (typeof value === 'object') {
            results.push(children.push(key));
          } else {
            results.push(void 0);
          }
        }
      }
      return results;
    }
  });

  Instance.prototype.renderDirectives = chainable(function(model, index, directives) {
    var attributes, element, key, results;
    results = [];
    for (key in directives) {
      if (!hasProp.call(directives, key)) continue;
      attributes = directives[key];
      if (!(typeof attributes === 'object')) {
        continue;
      }
      if (typeof model !== 'object') {
        model = {
          value: model
        };
      }
      results.push((function() {
        var i, len, ref, results1;
        ref = this.matchingElements(key);
        results1 = [];
        for (i = 0, len = ref.length; i < len; i++) {
          element = ref[i];
          results1.push(element.renderDirectives(model, index, attributes));
        }
        return results1;
      }).call(this));
    }
    return results;
  });

  Instance.prototype.renderChildren = chainable(function(model, children, directives, options) {
    var element, i, key, len, results;
    results = [];
    for (i = 0, len = children.length; i < len; i++) {
      key = children[i];
      results.push((function() {
        var j, len1, ref, results1;
        ref = this.matchingElements(key);
        results1 = [];
        for (j = 0, len1 = ref.length; j < len1; j++) {
          element = ref[j];
          results1.push(this.Transparency.render(element.el, model[key], directives[key], options));
        }
        return results1;
      }).call(this));
    }
    return results;
  });

  Instance.prototype.matchingElements = function(key) {
    var base, el, elements;
    elements = (base = this.queryCache)[key] || (base[key] = (function() {
      var i, len, ref, results;
      ref = this.elements;
      results = [];
      for (i = 0, len = ref.length; i < len; i++) {
        el = ref[i];
        if (this.Transparency.matcher(el, key)) {
          results.push(el);
        }
      }
      return results;
    }).call(this));
    helpers.log("Matching elements for '" + key + "':", elements);
    return elements;
  };

  return Instance;

})();

},{"../lib/lodash.js":7,"./helpers":5}],7:[function(require,module,exports){
 var _ = {};

_.toString = Object.prototype.toString;

_.toArray = function(obj) {
  var arr = new Array(obj.length);
  for (var i = 0; i < obj.length; i++) {
    arr[i] = obj[i];
  }
  return arr;
};

_.isString = function(obj) { return _.toString.call(obj) == '[object String]'; };

_.isNumber = function(obj) { return _.toString.call(obj) == '[object Number]'; };

_.isArray = Array.isArray || function(obj) {
  return _.toString.call(obj) === '[object Array]';
};

_.isDate = function(obj) {
  return _.toString.call(obj) === '[object Date]';
};

_.isElement = function(obj) {
  return !!(obj && obj.nodeType === 1);
};

_.isPlainValue = function(obj) {
  var type;
  type = typeof obj;
  return (type !== 'object' && type !== 'function') || exports.isDate(obj);
};

_.isBoolean = function(obj) {
  return obj === true || obj === false;
};

module.exports = _;

},{}]},{},[1]);
;
/**!
 * trunk8 v1.3.3
 * https://github.com/rviscomi/trunk8
 * 
 * Copyright 2012 Rick Viscomi
 * Released under the MIT License.
 * 
 * Date: September 26, 2012
 */

(function ($) {
	var methods,
		utils,
		SIDES = {
			/* cen...ter */
			center: 'center',
			/* ...left */
			left: 'left',
			/* right... */
			right: 'right'
		},
		WIDTH = {
			auto: 'auto'
		};
	
	function trunk8(element) {
		this.$element = $(element);
		this.original_text = this.$element.html().trim();
		this.settings = $.extend({}, $.fn.trunk8.defaults);
	}
	
	trunk8.prototype.updateSettings = function (options) {
		this.settings = $.extend(this.settings, options);
	};

	function stripHTML(html) {
		var tmp = document.createElement("DIV");
		tmp.innerHTML = html;
		
		if (typeof tmp.textContent != 'undefined') {
			return tmp.textContent;
		}

		return tmp.innerText
	}

	function getHtmlArr(str) {
		/* Builds an array of strings and designated */
		/* HTML tags around them. */
		if (stripHTML(str) === str) {
			return str.split(/\s/g);
		}
		var allResults = [],
			reg = /<([a-z]+)([^<]*)(?:>(.*?(?!<\1>)*)<\/\1>|\s+\/>)(['.?!,]*)|((?:[^<>\s])+['.?!,]*\w?|<br\s?\/?>)/ig,
			outArr = reg.exec(str),
			lastI,
			ind;
		while (outArr && lastI !== reg.lastIndex) {
			lastI = reg.lastIndex;
			if (outArr[5]) {
				allResults.push(outArr[5]);
			} else if (outArr[1]) {
				allResults.push({
					tag: outArr[1],
					attribs: outArr[2],
					content: outArr[3],
					after: outArr[4]
				});
			}
			outArr = reg.exec(str);
		}
		for (ind = 0; ind < allResults.length; ind++) {
			if (typeof allResults[ind] !== 'string' &&
					allResults[ind].content) {
				allResults[ind].content = getHtmlArr(allResults[ind].content);
			}
		}
		return allResults;
	}

	function rebuildHtmlFromBite(bite, htmlObject, fill) {
		// Take the processed bite after binary-search
		// truncated and re-build the original HTML
		// tags around the processed string.
		bite = bite.replace(fill, '');

		var biteHelper = function(contentArr, tagInfo) {
				var retStr = '',
					content,
					biteContent,
					biteLength,
					nextWord,
					i;
				for (i = 0; i < contentArr.length; i++) {
					content = contentArr[i];
					biteLength = $.trim(bite).split(' ').length;
					if ($.trim(bite).length) {
						if (typeof content === 'string') {
							if (!/<br\s*\/?>/.test(content)) {
								if (biteLength === 1 && $.trim(bite).length <= content.length) {
									content = bite;
									// We want the fill to go inside of the last HTML
									// element if the element is a container.
									if (tagInfo === 'p' || tagInfo === 'div') {
										content += fill;
									}
									bite = '';
								} else {
									bite = bite.replace(content, '');
								}
							}
							retStr += $.trim(content) + ((i === contentArr.length-1 || biteLength <= 1) ? '' : ' ');
						} else {
							biteContent = biteHelper(content.content, content.tag);
							if (content.after) bite = bite.replace(content.after, '');
							if (biteContent) {
								if (!content.after) content.after = ' ';
								retStr += '<'+content.tag+content.attribs+'>'+biteContent+'</'+content.tag+'>' + content.after;
							}
						}
					}
				}
				return retStr;
			},
			htmlResults = biteHelper(htmlObject);

		// Add fill if doesn't exist. This will place it outside the HTML elements.
		if (htmlResults.slice(htmlResults.length - fill.length) === fill) {
			htmlResults += fill;
		}

		return htmlResults;
	}

	function truncate() {
		var data = this.data('trunk8'),
			settings = data.settings,
			width = settings.width,
			side = settings.side,
			fill = settings.fill,
			parseHTML = settings.parseHTML,
			line_height = utils.getLineHeight(this) * settings.lines,
			str = data.original_text,
			length = str.length,
			max_bite = '',
			lower, upper,
			bite_size,
			bite,
			text,
			htmlObject;
		
		/* Reset the field to the original string. */
		this.html(str);
		text = this.text();

		/* If string has HTML and parse HTML is set, build */
		/* the data struct to house the tags */
		if (parseHTML && stripHTML(str) !== str) {
			htmlObject = getHtmlArr(str);
			str = stripHTML(str);
			length = str.length;
		}

		if (width === WIDTH.auto) {
			/* Assuming there is no "overflow: hidden". */
			if (this.height() <= line_height) {
				/* Text is already at the optimal trunkage. */
				return;
			}

			/* Binary search technique for finding the optimal trunkage. */
			/* Find the maximum bite without overflowing. */
			lower = 0;
			upper = length - 1;

			while (lower <= upper) {
				bite_size = lower + ((upper - lower) >> 1);
				
				bite = utils.eatStr(str, side, length - bite_size, fill);

				if (parseHTML && htmlObject) {
					bite = rebuildHtmlFromBite(bite, htmlObject, fill);
				}
				
				this.html(bite);

				/* Check for overflow. */
				if (this.height() > line_height) {
					upper = bite_size - 1;
				}
				else {
					lower = bite_size + 1;

					/* Save the bigger bite. */
					max_bite = (max_bite.length > bite.length) ? max_bite : bite;
				}
			}

			/* Reset the content to eliminate possible existing scroll bars. */
			this.html('');
			
			/* Display the biggest bite. */
			this.html(max_bite);
			
			if (settings.tooltip) {
				this.attr('title', text);
			}
		}
		else if (!isNaN(width)) {
			bite_size = length - width;

			bite = utils.eatStr(str, side, bite_size, fill);

			this.html(bite);
			
			if (settings.tooltip) {
				this.attr('title', str);
			}
		}
		else {
			$.error('Invalid width "' + width + '".');
			return;
		}
		settings.onTruncate();
	}

	methods = {
		init: function (options) {
			return this.each(function () {
				var $this = $(this),
					data = $this.data('trunk8');
				
				if (!data) {
					$this.data('trunk8', (data = new trunk8(this)));
				}
				
				data.updateSettings(options);
				
				truncate.call($this);
			});
		},

		/** Updates the text value of the elements while maintaining truncation. */
		update: function (new_string) {
			return this.each(function () {
				var $this = $(this);
				
				/* Update text. */
				if (new_string) {
					$this.data('trunk8').original_text = new_string;
				}

				/* Truncate accordingly. */
				truncate.call($this);
			});
		},
		
		revert: function () {
			return this.each(function () {
				/* Get original text. */
				var text = $(this).data('trunk8').original_text;
				
				/* Revert element to original text. */
				$(this).html(text);
			});
		},

		/** Returns this instance's settings object. NOT CHAINABLE. */
		getSettings: function () {
			return $(this.get(0)).data('trunk8').settings;
		}
	};

	utils = {
		/** Replaces [bite_size] [side]-most chars in [str] with [fill]. */
		eatStr: function (str, side, bite_size, fill) {
			var length = str.length,
				key = utils.eatStr.generateKey.apply(null, arguments),
				half_length,
				half_bite_size;

			/* If the result is already in the cache, return it. */
			if (utils.eatStr.cache[key]) {
				return utils.eatStr.cache[key];
			}
			
			/* Common error handling. */
			if ((typeof str !== 'string') || (length === 0)) {
				$.error('Invalid source string "' + str + '".');
			}
			if ((bite_size < 0) || (bite_size > length)) {
				$.error('Invalid bite size "' + bite_size + '".');
			}
			else if (bite_size === 0) {
				/* No bite should show no truncation. */
				return str;
			}
			if (typeof (fill + '') !== 'string') {
				$.error('Fill unable to be converted to a string.');
			}

			/* Compute the result, store it in the cache, and return it. */
			switch (side) {
				case SIDES.right:
					/* str... */
					return utils.eatStr.cache[key] =
							$.trim(str.substr(0, length - bite_size)) + fill;
					
				case SIDES.left:
					/* ...str */
					return utils.eatStr.cache[key] =
							fill + $.trim(str.substr(bite_size));
					
				case SIDES.center:
					/* Bit-shift to the right by one === Math.floor(x / 2) */
					half_length = length >> 1; // halve the length
					half_bite_size = bite_size >> 1; // halve the bite_size

					/* st...r */
					return utils.eatStr.cache[key] =
							$.trim(utils.eatStr(str.substr(0, length - half_length), SIDES.right, bite_size - half_bite_size, '')) +
							fill +
							$.trim(utils.eatStr(str.substr(length - half_length), SIDES.left, half_bite_size, ''));
					
				default:
					$.error('Invalid side "' + side + '".');
			}
		},
		
		getLineHeight: function (elem) {
				var floats = $(elem).css('float');
				if (floats !== 'none') {
					$(elem).css('float', 'none');
				}
				var pos = $(elem).css('position');
				if (pos === 'absolute') {
					$(elem).css('position', 'static');
				}
	
				var html = $(elem).html(),
				wrapper_id = 'line-height-test',
				line_height;
	
				/* Set the content to a small single character and wrap. */
				$(elem).html('i').wrap('<div id="' + wrapper_id + '" />');
	
				/* Calculate the line height by measuring the wrapper.*/
				line_height = $('#' + wrapper_id).innerHeight();
	
				/* Remove the wrapper and reset the content. */
				$(elem).html(html).css({ 'float': floats, 'position': pos }).unwrap();
	
				return line_height;
			}
	};

	utils.eatStr.cache = {};
	utils.eatStr.generateKey = function () {
		return Array.prototype.join.call(arguments, '');
	};
	
	$.fn.trunk8 = function (method) {
		if (methods[method]) {
			return methods[method].apply(this, Array.prototype.slice.call(arguments, 1));
		}
		else if (typeof method === 'object' || !method) {
			return methods.init.apply(this, arguments);
		}
		else {
			$.error('Method ' + method + ' does not exist on jQuery.trunk8');
		}
	};
	
	/* Default trunk8 settings. */
	$.fn.trunk8.defaults = {
		fill: '&hellip;',
		lines: 1,
		side: SIDES.right,
		tooltip: true,
		width: WIDTH.auto,
		parseHTML: false,
		onTruncate: function () {}
	};
})(jQuery);
;
// Generated by CoffeeScript 1.10.0
(function() {
  var base, base1, base2, base3, base4, base5, base6;

  if (window.C4 == null) {
    window.C4 = {};
  }

  if ((base = window.C4).Components == null) {
    base.Components = {};
  }

  if ((base1 = window.C4).Utilities == null) {
    base1.Utilities = {};
  }

  if (window.App == null) {
    window.App = {};
  }

  if ((base2 = window.App).Events == null) {
    base2.Events = {};
  }

  if ((base3 = window.App).Modules == null) {
    base3.Modules = {};
  }

  if ((base4 = window.App).Player == null) {
    base4.Player = {};
  }

  if ((base5 = window.App).Promos == null) {
    base5.Promos = {};
  }

  if ((base6 = window.App).Station == null) {
    base6.Station = {};
  }

}).call(this);
;
// Generated by CoffeeScript 1.10.0
(function() {
  C4.Utilities.Timer = (function() {
    function Timer() {}

    Timer.timers = {};

    Timer.delay = function(callback, ms, unique_id) {
      Timer.clearTimer(unique_id);
      Timer.timers[unique_id] = setTimeout(callback, ms);
      return true;
    };

    Timer.repeat = function(callback, ms, unique_id) {
      Timer.clearTimer(unique_id);
      Timer.timers[unique_id] = setInterval(callback, ms);
      return true;
    };

    Timer.clearTimer = function(unique_id) {
      if (unique_id == null) {
        throw "Unique id required but not provided";
      }
      if (unique_id in Timer.timers) {
        return clearTimeout(Timer.timers[unique_id]);
      }
    };

    return Timer;

  })();

}).call(this);
;
// Generated by CoffeeScript 1.10.0
(function() {
  (function($) {
    C4.Utilities.Touch = (function() {
      Touch.prototype.selector = ".touch-swipe";

      function Touch() {
        var $elements, elem, i, len;
        $elements = $(this.selector);
        for (i = 0, len = $elements.length; i < len; i++) {
          elem = $elements[i];
          this.addSwipe(elem);
        }
        true;
      }

      Touch.prototype.addSwipe = function(elem) {
        var $elem, hammer;
        $elem = $(elem);
        hammer = new Hammer(elem);
        hammer.on("swipeleft", (function(_this) {
          return function() {
            return $elem.carousel("next");
          };
        })(this));
        hammer.on("swiperight", (function(_this) {
          return function() {
            return $elem.carousel("prev");
          };
        })(this));
        return true;
      };

      return Touch;

    })();
    return $(function() {
      new C4.Utilities.Touch();
      return true;
    });
  })(jQuery);

}).call(this);
;
// Generated by CoffeeScript 1.10.0
(function() {
  (function($) {
    return C4.Utilities.Truncate = (function() {
      function Truncate() {}

      Truncate.truncated_elements = ".truncate";

      Truncate.truncate = function($parent) {
        var $collection;
        if (typeof $parent === 'undefined') {
          $parent = $(document);
        }
        $collection = $parent.find(Truncate.truncated_elements);
        return $collection.each(Truncate.truncateElement);
      };

      Truncate.truncateElement = function(index, element) {
        var $element, lines;
        $element = $(element);
        lines = 1;
        if ($element.data('truncate-lines') != null) {
          lines = $element.data('truncate-lines');
        }
        $element.trunk8({
          lines: lines
        });
        if (lines > 0 && !$element.text()) {
          $element.trunk8({
            lines: lines + 1
          });
        }
        return true;
      };

      return Truncate;

    })();
  })(jQuery);

}).call(this);
;
// Generated by CoffeeScript 1.10.0
(function() {
  (function($) {
    return C4.Utilities.Window = (function() {
      function Window() {}

      Window.resize = function(callback) {
        $(window).resize(function() {
          return C4.Utilities.Timer.delay(callback, 500, "c4_window");
        });
        return true;
      };

      return Window;

    })();
  })(jQuery);

}).call(this);
;
// Generated by CoffeeScript 1.10.0
(function() {
  (function($) {
    return C4.Components.Base = (function() {
      function Base() {
        this.init();
        this.bind();
      }

      Base.prototype.init = function() {
        this.$document = $(document);
        return true;
      };

      Base.prototype.bind = function() {
        return true;
      };

      Base.prototype.addItem = function(event, selector, callback) {
        return this.bindItem(event, selector, callback, true);
      };

      Base.prototype.bindItem = function(event, selector, callback, ignoreOff) {
        if (ignoreOff == null) {
          ignoreOff = false;
        }
        if (callback == null) {
          callback = selector;
          if (!ignoreOff) {
            this.$document.off(event);
          }
          return this.$document.on(event, callback);
        } else {
          if (!ignoreOff) {
            this.$document.off(event, selector);
          }
          return this.$document.on(event, selector, callback);
        }
      };

      Base.prototype.bindToObject = function(event, $object, callback, ignoreOff) {
        if (ignoreOff == null) {
          ignoreOff = false;
        }
        if (!ignoreOff) {
          $object.off(event);
        }
        return $object.on(event, callback);
      };

      return Base;

    })();
  })(jQuery);

}).call(this);
;
// Generated by CoffeeScript 1.10.0
(function() {
  var bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  (function($) {
    C4.Components.Accordion = (function(superClass) {
      extend(Accordion, superClass);

      function Accordion() {
        this.onShowAccordion = bind(this.onShowAccordion, this);
        return Accordion.__super__.constructor.apply(this, arguments);
      }

      Accordion.prototype.el = ".accordion-group";

      Accordion.prototype.bind = function() {
        this.bindItem("show.bs.collapse", this.el, this.onShowAccordion);
        return true;
      };

      Accordion.prototype.onShowAccordion = function(event) {
        var $accordions, $target;
        $target = $(event.target);
        $accordions = $target.closest(this.el);
        $accordions.find(".in").collapse("hide");
        return true;
      };

      return Accordion;

    })(C4.Components.Base);
    return $(function() {
      new C4.Components.Accordion();
      return true;
    });
  })(jQuery);

}).call(this);
;
// Generated by CoffeeScript 1.10.0
(function() {
  var bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  (function($) {
    return C4.Components.Dropdown = (function(superClass) {
      extend(Dropdown, superClass);

      function Dropdown() {
        this.dropdownShown = bind(this.dropdownShown, this);
        return Dropdown.__super__.constructor.apply(this, arguments);
      }

      Dropdown.prototype.dropdown = ".c4-dropdown";

      Dropdown.prototype.bind = function() {
        this.bindItem("shown.bs.dropdown", this.dropdown, this.dropdownShown);
        return true;
      };

      Dropdown.prototype.dropdownShown = function(event) {
        C4.Utilities.Truncate.truncate($(event.target));
        return true;
      };

      return Dropdown;

    })(C4.Components.Base);
  })(jQuery);

}).call(this);
;
// Generated by CoffeeScript 1.10.0
(function() {
  var base,
    bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  if ((base = window.C4.Components).Carousel == null) {
    base.Carousel = {};
  }

  (function($) {
    return C4.Components.Carousel.OutsideIndicators = (function(superClass) {
      extend(OutsideIndicators, superClass);

      function OutsideIndicators() {
        this.carouselSlid = bind(this.carouselSlid, this);
        this.indicatorClick = bind(this.indicatorClick, this);
        return OutsideIndicators.__super__.constructor.apply(this, arguments);
      }

      OutsideIndicators.prototype.carousel_item = '.carousel-item';

      OutsideIndicators.prototype.indicator = '.indicator-item';

      OutsideIndicators.prototype.indicators = '.carousel-indicators';

      OutsideIndicators.prototype.bind = function() {
        this.bindItem("slid.bs.carousel", this.carouselSlid);
        this.bindItem("click", this.indicator, this.indicatorClick);
        return true;
      };

      OutsideIndicators.prototype.indicatorClick = function(event) {
        var slide_to;
        event.preventDefault();
        slide_to = parseInt($(this).attr("data-slide-to"));
        this.$carousel.carousel(slide_to);
        $(this.indicator + ".active").removeClass("active");
        $(event.currentTarget).addClass("active");
        return true;
      };

      OutsideIndicators.prototype.carouselSlid = function() {
        var $active_item, slide_no;
        $active_item = $(this.carousel_item + ".active");
        slide_no = $active_item.attr("data-slide-no");
        $(this.indicator + ".active").removeClass("active");
        $(this.indicators + " [data-slide-to=" + slide_no + "]").addClass("active");
        return true;
      };

      return OutsideIndicators;

    })(C4.Components.Base);
  })(jQuery);

}).call(this);
;
// Generated by CoffeeScript 1.10.0
(function() {
  var bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  C4.Components.Yamm = (function(superClass) {
    extend(Yamm, superClass);

    function Yamm() {
      this.yammClick = bind(this.yammClick, this);
      return Yamm.__super__.constructor.apply(this, arguments);
    }

    Yamm.prototype.yamm = '.yamm .dropdown-menu';

    Yamm.prototype.bind = function() {
      this.addItem("click", this.yamm, this.yammClick);
      return true;
    };

    Yamm.prototype.yammClick = function(event) {
      event.stopPropagation();
      return true;
    };

    return Yamm;

  })(C4.Components.Base);

}).call(this);
;
// Generated by CoffeeScript 1.10.0
(function() {
  var bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  (function($) {
    return App.Events.Tabs = (function(superClass) {
      extend(Tabs, superClass);

      function Tabs() {
        this.tabChanged = bind(this.tabChanged, this);
        return Tabs.__super__.constructor.apply(this, arguments);
      }

      Tabs.prototype.tabs = ".nav.nav-pills";

      Tabs.prototype.init = function() {
        Tabs.__super__.init.call(this);
        C4.Utilities.Truncate.truncate($(this.tabs));
        return true;
      };

      Tabs.prototype.bind = function() {
        this.bindItem("shown.bs.tab", this.tabs, this.tabChanged);
        return true;
      };

      Tabs.prototype.tabChanged = function(event) {
        var tab_pane;
        tab_pane = $(event.target).attr('href');
        C4.Utilities.Truncate.truncate($(tab_pane));
        return true;
      };

      return Tabs;

    })(C4.Components.Base);
  })(jQuery);

}).call(this);
;
// Generated by CoffeeScript 1.10.0
(function() {
  var bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  (function($) {
    return App.Promos.Carousel = (function(superClass) {
      extend(Carousel, superClass);

      function Carousel() {
        this.carouselSlid = bind(this.carouselSlid, this);
        return Carousel.__super__.constructor.apply(this, arguments);
      }

      Carousel.prototype.$carousel = $('#carousel-promos');

      Carousel.prototype.init = function() {
        Carousel.__super__.init.call(this);
        C4.Utilities.Truncate.truncate(this.$carousel);
        return true;
      };

      Carousel.prototype.carouselSlid = function(event) {
        C4.Utilities.Truncate.truncate($(event.relatedTarget));
        Carousel.__super__.carouselSlid.call(this);
        return true;
      };

      return Carousel;

    })(C4.Components.Carousel.OutsideIndicators);
  })(jQuery);

}).call(this);
;
// Generated by CoffeeScript 1.10.0
(function() {
  var bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  (function($) {
    return App.Station.ListenNow = (function(superClass) {
      extend(ListenNow, superClass);

      function ListenNow() {
        this.getScrollbarWidth = bind(this.getScrollbarWidth, this);
        this.launch = bind(this.launch, this);
        this.onClick = bind(this.onClick, this);
        return ListenNow.__super__.constructor.apply(this, arguments);
      }

      ListenNow.prototype.button = ".launch-player";

      ListenNow.prototype.maxWidth = 768;

      ListenNow.prototype.maxHeight = 840;

      ListenNow.prototype.popupParams = "toolbar=no,location=no,directories=no,status=no,menubar=no,scrollbars=yes";

      ListenNow.prototype.init = function() {
        ListenNow.__super__.init.call(this);
        return true;
      };

      ListenNow.prototype.bind = function() {
        this.bindItem('click', this.button, this.onClick);
        return true;
      };

      ListenNow.prototype.onClick = function(event) {
        event.preventDefault();
        this.launch(event.currentTarget);
        return true;
      };

      ListenNow.prototype.launch = function(elem) {
        var $elem, deviceHeight, deviceWidth, params, stream, url;
        $elem = $(elem);
        stream = $elem.data('stream');
        deviceWidth = window.screen.width;
        if (deviceWidth > this.maxWidth) {
          deviceWidth = this.maxWidth;
        }
        deviceHeight = window.screen.height;
        if (deviceHeight > this.maxHeight) {
          deviceHeight = this.maxHeight;
        }
        if (deviceWidth === this.maxWidth) {
          deviceWidth += this.getScrollbarWidth();
          deviceHeight -= 18;
          params = "width=" + deviceWidth + ",height=" + deviceHeight + "," + this.popupParams;
        }
        url = "/listen/player/";
        if (stream === "two") {
          url = "/listen/player/?stream=two";
        }
        window.open(url, "player", params);
        return true;
      };

      ListenNow.prototype.getScrollbarWidth = function() {
        var div, width;
        div = document.createElement("div");
        div.innerHTML = "<div style=\"width:50px;height:50px;position:absolute;left:-50px;top:-50px;overflow:auto;\">\n  <div style=\"width:1px;height:100px;\"></div>\n</div>";
        div = div.firstChild;
        document.body.appendChild(div);
        width = div.offsetWidth - div.clientWidth;
        document.body.removeChild(div);
        return width + 20;
      };

      return ListenNow;

    })(C4.Components.Base);
  })(jQuery);

}).call(this);
;
// Generated by CoffeeScript 1.10.0
(function() {
  var modulo = function(a, b) { return (+a % (b = +b) + b) % b; };

  (function($) {
    return App.Station.OnAir = (function() {
      function OnAir() {}

      OnAir.interval = 60;

      OnAir.stream = null;

      OnAir.$el = null;

      OnAir.watch = function() {
        var callback;
        OnAir.interval = OnAir.interval * 1000;
        OnAir.$el = $('.on-air');
        OnAir.stream = OnAir.$el.attr('data-stream');
        callback = App.Station.OnAir.timeCheck;
        C4.Utilities.Timer.repeat(callback, OnAir.interval, "timeCheck");
        return true;
      };

      OnAir.timeCheck = function() {
        var d, five, minutes, zero;
        d = new Date();
        minutes = d.getMinutes();
        zero = minutes === 0;
        five = (modulo(minutes, 5)) === 0;
        if (zero || five) {
          OnAir.refresh();
        }
        return true;
      };

      OnAir.refresh = function() {
        var route, timestamp;
        timestamp = Math.floor(Date.now() / 1000);
        route = "/api/schedule/episode/" + OnAir.stream + "/at/" + timestamp;
        $.get(route, App.Station.OnAir.renderOnAir);
        return true;
      };

      OnAir.dataItem = function(item) {
        var data_item;
        data_item = {
          "program": {
            "text": item['title'],
            "href": item['url']
          }
        };
        return data_item;
      };

      OnAir.renderOnAir = function(response) {
        var data, directives;
        if (response == null) {
          return;
        }
        data = OnAir.dataItem(response);
        directives = {
          "title-link": {
            "text": function() {
              return this.program.text;
            },
            "href": function() {
              return this.program.href;
            }
          }
        };
        OnAir.$el.render(data, directives);
        return true;
      };

      return OnAir;

    })();
  })(jQuery);

}).call(this);
;
// Generated by CoffeeScript 1.10.0
(function() {
  var extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  (function($) {
    App.Main = (function(superClass) {
      extend(Main, superClass);

      function Main() {
        return Main.__super__.constructor.apply(this, arguments);
      }

      Main.prototype.init = function() {
        var ref;
        Main.__super__.init.call(this);
        if (((ref = window.stLight) != null ? ref.options : void 0) != null) {
          window.stLight.options({
            publisher: 'dr-3394c96a-919e-a703-795a-10d4d2ece1a5',
            onhover: false,
            version: "5x"
          });
        }
        C4.Utilities.Truncate.truncate();
        C4.Utilities.Window.resize(C4.Utilities.Truncate.truncate);
        App.Station.OnAir.watch();
        new C4.Components.Dropdown();
        new C4.Components.Yamm();
        new App.Events.Tabs();
        new App.Promos.Carousel();
        new App.Station.ListenNow();
        return true;
      };

      return Main;

    })(C4.Components.Base);
    return $(function() {
      new App.Main();
      return true;
    });
  })(jQuery);

}).call(this);
;
(function ($, Drupal, window, document, undefined) {
    //Configure colorbox call back to resize with custom dimensions
    $.colorbox.settings.onLoad = function () {
        colorboxResize();
    }

    //Customize colorbox dimensions
    var colorboxResize = function (resize) {
        var width = "300";
        var height = "380";

        if ($(window).width() > 767) {
            width = "736"
            height = "614"
        }
        //if ($(window).height() > 650) {
            //height = "614"
       // }

        $.colorbox.settings.height = height;
        $.colorbox.settings.width = width;

        //if window is resized while lightbox open
        if (resize) {
            $.colorbox.resize({
                'height': height,
                'width': width
            });
        }
    }

    //In case of window being resized
    $(window).resize(function () {
        colorboxResize(true);
    });

})(jQuery, Drupal, this, this.document);
;
