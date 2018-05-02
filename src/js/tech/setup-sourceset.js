import window from 'global/window';
import document from 'global/document';
import mergeOptions from '../utils/merge-options';

/**
 * This function is used to fire a sourceset when there is something
 * similar to `mediaEl.load()` being called. It will try to find the source via
 * the `src` attribute and then the `<source>` elements. It will then fire `sourceset`
 * with the source that was found or empty string if we cannot know. If it cannot
 * find a source then `sourceset` will not be fired.
 *
 * @param {Html5} tech
 *        The tech object that sourceset was setup on
 *
 * @return {boolean}
 *         returns false if the sourceset was not fired and true otherwise.
 */
const sourcesetLoad = (tech) => {
  const el = tech.el();

  // if `el.src` is set, that source will be loaded.
  if (el.src) {
    tech.triggerSourceset(el.src);
    return true;
  }

  /**
   * Since there isn't a src property on the media element, source elements will be used for
   * implementing the source selection algorithm. This happens asynchronously and
   * for most cases were there is more than one source we cannot tell what source will
   * be loaded, without re-implementing the source selection algorithm. At this time we are not
   * going to do that. There are three special cases that we do handle here though:
   *
   * 1. If there are no sources, do not fire `sourceset`.
   * 2. If there is only one `<source>` with a `src` property/attribute that is our `src`
   * 3. If there is more than one `<source>` but all of them have the same `src` url.
   *    That will be our src.
   */
  const sources = tech.$$('source');
  const srcUrls = [];
  let src = '';

  // if there are no sources, do not fire sourceset
  if (!sources.length) {
    return false;
  }

  // only count valid/non-duplicate source elements
  for (let i = 0; i < sources.length; i++) {
    const url = sources[i].src;

    if (url && srcUrls.indexOf(url) === -1) {
      srcUrls.push(url);
    }
  }

  // there were no valid sources
  if (!srcUrls.length) {
    return;
  }

  // there is only one valid source element url
  // use that
  if (srcUrls.length === 1) {
    src = srcUrls[0];
  }

  tech.triggerSourceset(src);
  return true;
};

/**
 * Get the browsers property descriptor for the `innerHTML`
 * property. This will allow us to overwrite it without
 * destroying native functionality.
 *
 * @param {HTMLMediaElement} el
 *        The tech element that should be used to get the descriptor
 *
 * @return {Object}
 *          The property descriptor for innerHTML.
 */
const getInnerHTMLDescriptor = (el) => {
  const proto = window.Element.prototype;
  let innerDescriptor = {};

  // preserve getters/setters already on `el.innerHTML` if they exist
  if (Object.getOwnPropertyDescriptor(el, 'innerHTML')) {
    innerDescriptor = Object.getOwnPropertyDescriptor(el, 'innerHTML');
  } else if (Object.getOwnPropertyDescriptor(proto, 'innerHTML')) {
    innerDescriptor = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
  }

  if (!innerDescriptor.get) {
    innerDescriptor.get = function() {
      return el.cloneNode().innerHTML;
    };
  }

  if (!innerDescriptor.set) {
    innerDescriptor.set = function(v) {
      // remove all current content from inside
      el.innerText = '';

      // make a dummy node to use innerHTML on
      const dummy = document.createElement(el.nodeName.toLowerCase());

      // set innerHTML to the value provided
      dummy.innerHTML = v;

      // make a document fragment to hold the nodes from dummy
      const docFrag = document.createDocumentFragment();

      // copy all of the nodes created by the innerHTML on dummy
      // to the document fragment
      while (dummy.childNodes.length) {
        docFrag.appendChild(dummy.childNodes[0]);
      }

      // now we add all of that html in one by appending the
      // document fragment. This is how innerHTML does it.
      window.Element.prototype.appendChild.call(el, docFrag);

      // then return the result that innerHTML's setter would
      return el.innerHTML;
    };
  }

  if (typeof innerDescriptor.enumerable === 'undefined') {
    innerDescriptor.enumerable = true;
  }

  innerDescriptor.configurable = true;

  return innerDescriptor;
};

/**
 * Get the browsers property descriptor for the `src`
 * property. This will allow us to overwrite it without
 * destroying native functionality.
 *
 * @param {HTMLMediaElement} el
 *        The tech element that should be used to get the descriptor
 *
 * @return {Object}
 *          The property descriptor for `src`.
 */
const getSrcDescriptor = (el) => {
  const proto = window.HTMLMediaElement.prototype;
  let srcDescriptor = {};

  // preserve getters/setters already on `el.src` if they exist
  if (Object.getOwnPropertyDescriptor(el, 'src')) {
    srcDescriptor = Object.getOwnPropertyDescriptor(el, 'src');
  } else if (Object.getOwnPropertyDescriptor(proto, 'src')) {
    srcDescriptor = mergeOptions(srcDescriptor, Object.getOwnPropertyDescriptor(proto, 'src'));
  }

  if (!srcDescriptor.get) {
    srcDescriptor.get = function() {
      return proto.getAttribute.call(el, 'src');
    };
  }

  if (!srcDescriptor.set) {
    srcDescriptor.set = function(v) {
      return proto.setAttribute.call(el, 'src', v);
    };
  }

  if (typeof srcDescriptor.enumerable === 'undefined') {
    srcDescriptor.enumerable = true;
  }

  srcDescriptor.configurable = true;

  return srcDescriptor;
};

/**
 * Patches browser internal functions so that we can tell synchronously
 * if a `<source>` was appended to the media element. For some reason this
 * causes a `sourceset` if the the media element is ready and has no source.
 * This happens when:
 * - The page has just loaded and the media element does not have a source.
 * - The media element was emptied of all sources, then `load()` was called.
 *
 * It does this by patching the following functions/properties when they are supported:
 *
 * - `append()` - can be used to add a `<source>` element to the media element
 * - `appendChild()` - can be used to add a `<source>` element to the media element
 * - `insertAdjacentHTML()` -  can be used to add a `<source>` element to the media element
 * - `innerHTML` -  can be used to add a `<source>` element to the media element
 *
 * @param {Html5} tech
 *        The tech object that sourceset is being setup on.
 */
const firstSourceWatch = function(tech) {
  const el = tech.el();

  // make sure firstSourceWatch isn't setup twice.
  if (el.firstSourceWatch_) {
    return;
  }

  el.firstSourceWatch_ = true;
  const oldAppend = el.append;
  const oldAppendChild = el.appendChild;
  const oldInsertAdjacentHTML = el.insertAdjacentHTML;
  const innerDescriptor = getInnerHTMLDescriptor(el);

  el.appendChild = function() {
    const retval = oldAppendChild.apply(el, arguments);

    sourcesetLoad(tech);

    return retval;
  };

  if (oldAppend) {
    el.append = function() {
      const retval = oldAppend.apply(el, arguments);

      sourcesetLoad(tech);

      return retval;
    };
  }

  if (oldInsertAdjacentHTML) {
    el.insertAdjacentHTML = function() {
      const retval = oldInsertAdjacentHTML.apply(el, arguments);

      sourcesetLoad(tech);

      return retval;
    };
  }

  Object.defineProperty(el, 'innerHTML', {
    get: innerDescriptor.get.bind(el),
    set(v) {
      const retval = innerDescriptor.set.call(el, v);

      sourcesetLoad(tech);

      return retval;
    },
    configurable: true,
    enumerable: innerDescriptor.enumerable
  });

  // on the first sourceset, we need to revert
  // our changes
  tech.one('sourceset', (e) => {
    el.firstSourceWatch_ = false;
    el.appendChild = oldAppendChild;

    if (oldAppend) {
      el.append = oldAppend;
    }
    if (oldInsertAdjacentHTML) {
      el.insertAdjacentHTML = oldInsertAdjacentHTML;
    }

    Object.defineProperty(el, 'innerHTML', innerDescriptor);
  });
};

/**
 * setup `sourceset` handling on the `Html5` tech. This function
 * patches the following element properties/functions:
 *
 * - `src` - to determine when `src` is set
 * - `setAttribute()` - to determine when `src` is set
 * - `load()` - this re-triggers the source selection algorithm, and can
 *              cause a sourceset.
 *
 * If there is no source when we are adding `sourceset` support or during a `load()`
 * we also patch the functions listed in `firstSourceWatch`.
 *
 * @param {Html5} tech
 *        The tech to patch
 */
const setupSourceset = function(tech) {
  if (!tech.featuresSourceset) {
    return;
  }

  const el = tech.el();

  // make sure sourceset isn't setup twice.
  if (el.setupSourceset_) {
    return;
  }

  el.setupSourceset_ = true;

  const srcDescriptor = getSrcDescriptor(el);
  const oldSetAttribute = el.setAttribute;
  const oldLoad = el.load;

  // we need to fire sourceset when the player is ready
  // if we find that the media element had a src when it was
  // given to us and that tech element is not in a stalled state
  if (el.src || el.currentSrc && el.initNetworkState_ !== 3) {
    if (el.currentSrc) {
      tech.triggerSourceset(el.currentSrc);
    } else {
      sourcesetLoad(tech);
    }
  }

  // for some reason adding a source element when a mediaElement has no source
  // calls `load` internally right away. We need to handle that.
  if (!el.src && !el.currentSrc && !tech.$$('source').length) {
    firstSourceWatch(tech);
  }

  Object.defineProperty(el, 'src', {
    get: srcDescriptor.get.bind(el),
    set: (v) => {
      const retval = srcDescriptor.set.call(el, v);

      // we use the getter here to get the actual value set on src
      tech.triggerSourceset(el.src);

      return retval;
    },
    configurable: true,
    enumerable: srcDescriptor.enumerable
  });

  el.setAttribute = (n, v) => {
    const retval = oldSetAttribute.call(el, n, v);

    if (n === 'src') {
      tech.triggerSourceset(el.getAttribute('src'));
    }

    return retval;
  };

  el.load = () => {
    const retval = oldLoad.call(el);

    // if load was called, but there was no source to fire
    // sourceset on. We have to watch for a source append
    // as that can trigger a `sourceset` when the media element
    // has no source
    if (!sourcesetLoad(tech)) {
      firstSourceWatch(tech);
    }

    return retval;
  };
};

export default setupSourceset;
