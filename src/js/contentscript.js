/*******************************************************************************

    uMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014-2017 Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uMatrix
*/

/* global HTMLDocument, XMLDocument */

'use strict';

/******************************************************************************/
/******************************************************************************/

// Injected into content pages

(function() {

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/464
// https://github.com/gorhill/uMatrix/issues/621
if (
    document instanceof HTMLDocument === false &&
    document instanceof XMLDocument === false
) {
    return;
}

// This can also happen (for example if script injected into a `data:` URI doc)
if ( !window.location ) {
    return;
}

// This can happen
if ( typeof vAPI !== 'object' ) {
    //console.debug('contentscript.js > vAPI not found');
    return;
}

// https://github.com/chrisaljoudi/uBlock/issues/456
// Already injected?
if ( vAPI.contentscriptEndInjected ) {
    //console.debug('contentscript.js > content script already injected');
    return;
}
vAPI.contentscriptEndInjected = true;

/******************************************************************************/
/******************************************************************************/

// Executed only once.

(function() {
    var localStorageHandler = function(mustRemove) {
        if ( mustRemove ) {
            window.localStorage.clear();
            window.sessionStorage.clear();
        }
    };

    // Check with extension whether local storage must be emptied
    // rhill 2014-03-28: we need an exception handler in case 3rd-party access
    // to site data is disabled.
    // https://github.com/gorhill/httpswitchboard/issues/215
    try {
        var hasLocalStorage =
            window.localStorage && window.localStorage.length !== 0;
        var hasSessionStorage =
            window.sessionStorage && window.sessionStorage.length !== 0;
        if ( hasLocalStorage || hasSessionStorage ) {
            vAPI.messaging.send('contentscript.js', {
                what: 'contentScriptHasLocalStorage',
                originURL: window.location.origin
            }, localStorageHandler);
        }

        // TODO: indexedDB
        //if ( window.indexedDB && !!window.indexedDB.webkitGetDatabaseNames ) {
            // var db = window.indexedDB.webkitGetDatabaseNames().onsuccess = function(sender) {
            //    console.debug('webkitGetDatabaseNames(): result=%o', sender.target.result);
            // };
        //}

        // TODO: Web SQL
        // if ( window.openDatabase ) {
            // Sad:
            // "There is no way to enumerate or delete the databases available for an origin from this API."
            // Ref.: http://www.w3.org/TR/webdatabase/#databases
        // }
    }
    catch (e) {
    }
})();

/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/uMatrix/issues/45

var collapser = (function() {
    var resquestIdGenerator = 1,
        processTimer,
        toProcess = [],
        toFilter = [],
        toCollapse = new Map(),
        cachedBlockedMap,
        cachedBlockedMapHash,
        cachedBlockedMapTimer,
        reURLPlaceholder = /\{\{url\}\}/g;
    var src1stProps = {
        'embed': 'src',
        'iframe': 'src',
        'img': 'src',
        'object': 'data'
    };
    var src2ndProps = {
        'img': 'srcset'
    };
    var tagToTypeMap = {
        embed: 'media',
        iframe: 'frame',
        img: 'image',
        object: 'media'
    };
    var cachedBlockedSetClear = function() {
        cachedBlockedMap =
        cachedBlockedMapHash =
        cachedBlockedMapTimer = undefined;
    };

    // https://github.com/chrisaljoudi/uBlock/issues/174
    //   Do not remove fragment from src URL
    var onProcessed = function(response) {
        if ( !response ) { // This happens if uBO is disabled or restarted.
            toCollapse.clear();
            return;
        }

        var targets = toCollapse.get(response.id);
        if ( targets === undefined ) { return; }
        toCollapse.delete(response.id);
        if ( cachedBlockedMapHash !== response.hash ) {
            cachedBlockedMap = new Map(response.blockedResources);
            cachedBlockedMapHash = response.hash;
            if ( cachedBlockedMapTimer !== undefined ) {
                clearTimeout(cachedBlockedMapTimer);
            }
            cachedBlockedMapTimer = vAPI.setTimeout(cachedBlockedSetClear, 30000);
        }
        if ( cachedBlockedMap === undefined || cachedBlockedMap.size === 0 ) {
            return;
        }

        var placeholders = response.placeholders,
            tag, prop, src, collapsed, docurl, replaced;

        for ( var target of targets ) {
            tag = target.localName;
            prop = src1stProps[tag];
            if ( prop === undefined ) { continue; }
            src = target[prop];
            if ( typeof src !== 'string' || src.length === 0 ) {
                prop = src2ndProps[tag];
                if ( prop === undefined ) { continue; }
                src = target[prop];
                if ( typeof src !== 'string' || src.length === 0 ) { continue; }
            }
            collapsed = cachedBlockedMap.get(tagToTypeMap[tag] + ' ' + src);
            if ( collapsed === undefined ) { continue; }
            if ( collapsed ) {
                target.style.setProperty('display', 'none', 'important');
                target.hidden = true;
                continue;
            }
            if ( tag === 'iframe' ) {
                docurl =
                    'data:text/html,' +
                    encodeURIComponent(
                        placeholders.iframe.replace(reURLPlaceholder, src)
                    );
                replaced = false;
                // Using contentWindow.location prevent tainting browser
                // history -- i.e. breaking back button (seen on Chromium).
                if ( target.contentWindow ) {
                    try {
                        target.contentWindow.location.replace(docurl);
                        replaced = true;
                    } catch(ex) {
                    }
                }
                if ( !replaced ) {
                    target.setAttribute('src', docurl);
                }
                continue;
            }
            target.setAttribute(src1stProps[tag], placeholders[tag]);
            target.style.setProperty('display', 'inline-block');
            target.style.setProperty('min-width', '20px', 'important');
            target.style.setProperty('min-height', '20px', 'important');
            target.style.setProperty('border', placeholders.border, 'important');
            target.style.setProperty('background', placeholders.background, 'important');
        }
    };

    var send = function() {
        processTimer = undefined;
        toCollapse.set(resquestIdGenerator, toProcess);
        var msg = {
            what: 'lookupBlockedCollapsibles',
            id: resquestIdGenerator,
            toFilter: toFilter,
            hash: cachedBlockedMapHash
        };
        vAPI.messaging.send('contentscript.js', msg, onProcessed);
        toProcess = [];
        toFilter = [];
        resquestIdGenerator += 1;
    };

    var process = function(delay) {
        if ( toProcess.length === 0 ) { return; }
        if ( delay === 0 ) {
            if ( processTimer !== undefined ) {
                clearTimeout(processTimer);
            }
            send();
        } else if ( processTimer === undefined ) {
            processTimer = vAPI.setTimeout(send, delay || 47);
        }
    };

    var add = function(target) {
        toProcess.push(target);
    };

    var addMany = function(targets) {
        var i = targets.length;
        while ( i-- ) {
            toProcess.push(targets[i]);
        }
    };

    var iframeSourceModified = function(mutations) {
        var i = mutations.length;
        while ( i-- ) {
            addIFrame(mutations[i].target, true);
        }
        process();
    };
    var iframeSourceObserver;
    var iframeSourceObserverOptions = {
        attributes: true,
        attributeFilter: [ 'src' ]
    };

    var addIFrame = function(iframe, dontObserve) {
        // https://github.com/gorhill/uBlock/issues/162
        // Be prepared to deal with possible change of src attribute.
        if ( dontObserve !== true ) {
            if ( iframeSourceObserver === undefined ) {
                iframeSourceObserver = new MutationObserver(iframeSourceModified);
            }
            iframeSourceObserver.observe(iframe, iframeSourceObserverOptions);
        }
        var src = iframe.src;
        if ( src === '' || typeof src !== 'string' ) { return; }
        if ( src.startsWith('http') === false ) { return; }
        toFilter.push({ type: 'frame', url: iframe.src });
        add(iframe);
    };

    var addIFrames = function(iframes) {
        var i = iframes.length;
        while ( i-- ) {
            addIFrame(iframes[i]);
        }
    };

    var addNodeList = function(nodeList) {
        var node,
            i = nodeList.length;
        while ( i-- ) {
            node = nodeList[i];
            if ( node.nodeType !== 1 ) { continue; }
            if ( node.localName === 'iframe' ) {
                addIFrame(node);
            }
            if ( node.childElementCount !== 0 ) {
                addIFrames(node.querySelectorAll('iframe'));
            }
        }
    };

    var onResourceFailed = function(ev) {
        if ( tagToTypeMap[ev.target.localName] !== undefined ) {
            add(ev.target);
            process();
        }
    };
    document.addEventListener('error', onResourceFailed, true);

    vAPI.shutdown.add(function() {
        document.removeEventListener('error', onResourceFailed, true);
        if ( iframeSourceObserver !== undefined ) {
            iframeSourceObserver.disconnect();
            iframeSourceObserver = undefined;
        }
        if ( processTimer !== undefined ) {
            clearTimeout(processTimer);
            processTimer = undefined;
        }
    });

    return {
        addMany: addMany,
        addIFrames: addIFrames,
        addNodeList: addNodeList,
        process: process
    };
})();

/******************************************************************************/
/******************************************************************************/

// Observe changes in the DOM

// Added node lists will be cumulated here before being processed

(function() {
    // This fixes http://acid3.acidtests.org/
    if ( !document.body ) { return; }

    var addedNodeLists = [];
    var addedNodeListsTimer;

    var treeMutationObservedHandler = function() {
        addedNodeListsTimer = undefined;
        var i = addedNodeLists.length;
        while ( i-- ) {
            collapser.addNodeList(addedNodeLists[i]);
        }
        collapser.process();
        addedNodeLists = [];
    };

    // https://github.com/gorhill/uBlock/issues/205
    // Do not handle added node directly from within mutation observer.
    var treeMutationObservedHandlerAsync = function(mutations) {
        var iMutation = mutations.length,
            nodeList;
        while ( iMutation-- ) {
            nodeList = mutations[iMutation].addedNodes;
            if ( nodeList.length !== 0 ) {
                addedNodeLists.push(nodeList);
            }
        }
        if ( addedNodeListsTimer === undefined ) {
            addedNodeListsTimer = vAPI.setTimeout(treeMutationObservedHandler, 47);
        }
    };

    // https://github.com/gorhill/httpswitchboard/issues/176
    var treeObserver = new MutationObserver(treeMutationObservedHandlerAsync);
    treeObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    vAPI.shutdown.add(function() {
        if ( addedNodeListsTimer !== undefined ) {
            clearTimeout(addedNodeListsTimer);
            addedNodeListsTimer = undefined;
        }
        if ( treeObserver !== null ) {
            treeObserver.disconnect();
            treeObserver = undefined;
        }
        addedNodeLists = [];
    });
})();

/******************************************************************************/
/******************************************************************************/

// Executed only once.

// https://github.com/gorhill/httpswitchboard/issues/25

// https://github.com/gorhill/httpswitchboard/issues/131
//   Looks for inline javascript also in at least one a[href] element.

// https://github.com/gorhill/uMatrix/issues/485
//   Mind "on..." attributes.

(function() {
    if (
        document.querySelector('script:not([src])') !== null ||
        document.querySelector('a[href^="javascript:"]') !== null ||
        document.querySelector('[onabort],[onblur],[oncancel],[oncanplay],[oncanplaythrough],[onchange],[onclick],[onclose],[oncontextmenu],[oncuechange],[ondblclick],[ondrag],[ondragend],[ondragenter],[ondragexit],[ondragleave],[ondragover],[ondragstart],[ondrop],[ondurationchange],[onemptied],[onended],[onerror],[onfocus],[oninput],[oninvalid],[onkeydown],[onkeypress],[onkeyup],[onload],[onloadeddata],[onloadedmetadata],[onloadstart],[onmousedown],[onmouseenter],[onmouseleave],[onmousemove],[onmouseout],[onmouseover],[onmouseup],[onwheel],[onpause],[onplay],[onplaying],[onprogress],[onratechange],[onreset],[onresize],[onscroll],[onseeked],[onseeking],[onselect],[onshow],[onstalled],[onsubmit],[onsuspend],[ontimeupdate],[ontoggle],[onvolumechange],[onwaiting],[onafterprint],[onbeforeprint],[onbeforeunload],[onhashchange],[onlanguagechange],[onmessage],[onoffline],[ononline],[onpagehide],[onpageshow],[onrejectionhandled],[onpopstate],[onstorage],[onunhandledrejection],[onunload],[oncopy],[oncut],[onpaste]') !== null
    ) {
        vAPI.messaging.send('contentscript.js', {
            what: 'securityPolicyViolation',
            directive: 'script-src',
            documentURI: window.location.href
        });
    }

    collapser.addMany(document.querySelectorAll('img'));
    collapser.addIFrames(document.querySelectorAll('iframe'));
    collapser.process();
})();

/******************************************************************************/
/******************************************************************************/

// Executed only once.

// https://github.com/gorhill/uMatrix/issues/232
//   Force `display` property, Firefox is still affected by the issue.

(function() {
    var noscripts = document.querySelectorAll('noscript');
    if ( noscripts.length === 0 ) { return; }

    var redirectTimer,
        reMetaContent = /^\s*(\d+)\s*;\s*url=(['"]?)([^'"]+)\2/i,
        reSafeURL = /^https?:\/\//;

    var autoRefresh = function(root) {
        var meta = root.querySelector('meta[http-equiv="refresh"][content]');
        if ( meta === null ) { return; }
        var match = reMetaContent.exec(meta.getAttribute('content'));
        if ( match === null || match[3].trim() === '' ) { return; }
        var url = new URL(match[3], document.baseURI);
        if ( reSafeURL.test(url.href) === false ) { return; }
        redirectTimer = setTimeout(
            function() {
                location.assign(url.href);
            },
            parseInt(match[1], 10) * 1000 + 1
        );
        meta.parentNode.removeChild(meta);
    };

    var renderNoscriptTags = function(response) {
        if ( response !== true ) { return; }
        var parser = new DOMParser();
        var doc, parent, span;
        for ( var noscript of noscripts ) {
            parent = noscript.parentNode;
            if ( parent === null ) { continue; }
            doc = parser.parseFromString(
                '<span>' + noscript.textContent + '</span>',
                'text/html'
            );
            span = document.adoptNode(doc.querySelector('span'));
            span.style.setProperty('display', 'inline', 'important');
            if ( redirectTimer === undefined ) {
                autoRefresh(span);
            }
            parent.replaceChild(span, noscript);
        }
    };

    vAPI.messaging.send(
        'contentscript.js',
        { what: 'mustRenderNoscriptTags?' },
        renderNoscriptTags
    );
})();

/******************************************************************************/
/******************************************************************************/

vAPI.messaging.send(
    'contentscript.js',
    { what: 'shutdown?' },
    function(response) {
        if ( response === true ) {
            vAPI.shutdown.exec();
        }
    }
);

/******************************************************************************/
/******************************************************************************/

})();
