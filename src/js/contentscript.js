/*******************************************************************************

    uMatrix - a browser extension to black/white list requests.
    Copyright (C) 2014-present Raymond Hill

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

(( ) => {

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
if ( !window.location ) { return; }

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

{
    const localStorageHandler = function(mustRemove) {
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
        const hasLocalStorage =
            window.localStorage && window.localStorage.length !== 0;
        const hasSessionStorage =
            window.sessionStorage && window.sessionStorage.length !== 0;
        if ( hasLocalStorage || hasSessionStorage ) {
            vAPI.messaging.send('contentscript.js', {
                what: 'contentScriptHasLocalStorage',
                originURL: window.location.origin,
            }).then(response => {
                localStorageHandler(response);
            });
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
}

/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/uMatrix/issues/45

const collapser = (( ) => {
    let resquestIdGenerator = 1,
        processTimer,
        toProcess = [],
        toFilter = [],
        cachedBlockedMap,
        cachedBlockedMapHash,
        cachedBlockedMapTimer;
    const toCollapse = new Map();
    const reURLPlaceholder = /\{\{url\}\}/g;
    const src1stProps = {
        'embed': 'src',
        'frame': 'src',
        'iframe': 'src',
        'img': 'src',
        'object': 'data'
    };
    const src2ndProps = {
        'img': 'srcset'
    };
    const tagToTypeMap = {
        embed: 'media',
        frame: 'frame',
        iframe: 'frame',
        img: 'image',
        object: 'media'
    };
    const cachedBlockedSetClear = function() {
        cachedBlockedMap =
        cachedBlockedMapHash =
        cachedBlockedMapTimer = undefined;
    };

    // https://github.com/chrisaljoudi/uBlock/issues/174
    //   Do not remove fragment from src URL
    const onProcessed = function(response) {
        if ( !response ) { // This happens if uBO is disabled or restarted.
            toCollapse.clear();
            return;
        }

        const targets = toCollapse.get(response.id);
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

        const placeholders = response.placeholders;

        for ( const target of targets ) {
            const tag = target.localName;
            let prop = src1stProps[tag];
            if ( prop === undefined ) { continue; }
            let src = target[prop];
            if ( typeof src !== 'string' || src.length === 0 ) {
                prop = src2ndProps[tag];
                if ( prop === undefined ) { continue; }
                src = target[prop];
                if ( typeof src !== 'string' || src.length === 0 ) { continue; }
            }
            const collapsed = cachedBlockedMap.get(tagToTypeMap[tag] + ' ' + src);
            if ( collapsed === undefined ) { continue; }
            if ( collapsed ) {
                target.style.setProperty('display', 'none', 'important');
                target.hidden = true;
                continue;
            }
            switch ( tag ) {
            case 'frame':
            case 'iframe':
                if ( placeholders.frame !== true ) { break; }
                const docurl =
                    'data:text/html,' +
                    encodeURIComponent(
                        placeholders.frameDocument.replace(
                            reURLPlaceholder,
                            src
                        )
                    );
                let replaced = false;
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
                break;
            case 'img':
                if ( placeholders.image !== true ) { break; }
                // Do not insert placeholder if the image was actually loaded.
                // This can happen if an allow rule was created while the
                // document was loading.
                if (
                    target.complete &&
                    target.naturalWidth !== 0 &&
                    target.naturalHeight !== 0
                ) {
                    break;
                }
                target.style.setProperty('display', 'inline-block');
                target.style.setProperty('min-width', '20px', 'important');
                target.style.setProperty('min-height', '20px', 'important');
                target.style.setProperty(
                    'border',
                    placeholders.imageBorder,
                    'important'
                );
                target.style.setProperty(
                    'background',
                    placeholders.imageBackground,
                    'important'
                );
                break;
            }
        }
    };

    const send = function() {
        processTimer = undefined;
        toCollapse.set(resquestIdGenerator, toProcess);
        vAPI.messaging.send('contentscript.js', {
            what: 'lookupBlockedCollapsibles',
            id: resquestIdGenerator,
            toFilter: toFilter,
            hash: cachedBlockedMapHash,
        }).then(response => {
            onProcessed(response);
        });
        toProcess = [];
        toFilter = [];
        resquestIdGenerator += 1;
    };

    const process = function(delay) {
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

    const add = function(target) {
        toProcess.push(target);
    };

    var addMany = function(targets) {
        var i = targets.length;
        while ( i-- ) {
            toProcess.push(targets[i]);
        }
    };

    const iframeSourceModified = function(mutations) {
        let i = mutations.length;
        while ( i-- ) {
            addIFrame(mutations[i].target, true);
        }
        process();
    };
    let iframeSourceObserver;
    const iframeSourceObserverOptions = {
        attributes: true,
        attributeFilter: [ 'src' ],
    };

    const addIFrame = function(iframe, dontObserve) {
        // https://github.com/gorhill/uBlock/issues/162
        // Be prepared to deal with possible change of src attribute.
        if ( dontObserve !== true ) {
            if ( iframeSourceObserver === undefined ) {
                iframeSourceObserver = new MutationObserver(iframeSourceModified);
            }
            iframeSourceObserver.observe(iframe, iframeSourceObserverOptions);
        }
        const src = iframe.src;
        if ( src === '' || typeof src !== 'string' ) { return; }
        if ( src.startsWith('http') === false ) { return; }
        toFilter.push({ type: 'frame', url: iframe.src });
        add(iframe);
    };

    const addIFrames = function(iframes) {
        let i = iframes.length;
        while ( i-- ) {
            addIFrame(iframes[i]);
        }
    };

    const addNodeList = function(nodeList) {
        let i = nodeList.length;
        while ( i-- ) {
            const node = nodeList[i];
            if ( node.nodeType !== 1 ) { continue; }
            if ( node.localName === 'iframe' || node.localName === 'frame' ) {
                addIFrame(node);
            }
            if ( node.childElementCount !== 0 ) {
                addIFrames(node.querySelectorAll('iframe, frame'));
            }
        }
    };

    const onResourceFailed = function(ev) {
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
        addMany,
        addIFrames,
        addNodeList,
        process,
    };
})();

/******************************************************************************/
/******************************************************************************/

// Observe changes in the DOM

// Added node lists will be cumulated here before being processed

(( ) => {
    // This fixes http://acid3.acidtests.org/
    if ( !document.body ) { return; }

    let addedNodeLists = [];
    let addedNodeListsTimer;

    const treeMutationObservedHandler = function() {
        addedNodeListsTimer = undefined;
        let i = addedNodeLists.length;
        while ( i-- ) {
            collapser.addNodeList(addedNodeLists[i]);
        }
        collapser.process();
        addedNodeLists = [];
    };

    // https://github.com/gorhill/uBlock/issues/205
    // Do not handle added node directly from within mutation observer.
    const treeMutationObservedHandlerAsync = function(mutations) {
        let iMutation = mutations.length;
        while ( iMutation-- ) {
            const nodeList = mutations[iMutation].addedNodes;
            if ( nodeList.length !== 0 ) {
                addedNodeLists.push(nodeList);
            }
        }
        if ( addedNodeListsTimer === undefined ) {
            addedNodeListsTimer = vAPI.setTimeout(treeMutationObservedHandler, 47);
        }
    };

    // https://github.com/gorhill/httpswitchboard/issues/176
    let treeObserver = new MutationObserver(treeMutationObservedHandlerAsync);
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
//
// https://github.com/gorhill/httpswitchboard/issues/25
//
// https://github.com/gorhill/httpswitchboard/issues/131
//   Looks for inline javascript also in at least one a[href] element.
//
// https://github.com/gorhill/uMatrix/issues/485
//   Mind "on..." attributes.
//
// https://github.com/gorhill/uMatrix/issues/924
//   Report inline styles.

{
    if (
        document.querySelector('script:not([src])') !== null ||
        document.querySelector('a[href^="javascript:"]') !== null ||
        document.querySelector('[onabort],[onblur],[oncancel],[oncanplay],[oncanplaythrough],[onchange],[onclick],[onclose],[oncontextmenu],[oncuechange],[ondblclick],[ondrag],[ondragend],[ondragenter],[ondragexit],[ondragleave],[ondragover],[ondragstart],[ondrop],[ondurationchange],[onemptied],[onended],[onerror],[onfocus],[oninput],[oninvalid],[onkeydown],[onkeypress],[onkeyup],[onload],[onloadeddata],[onloadedmetadata],[onloadstart],[onmousedown],[onmouseenter],[onmouseleave],[onmousemove],[onmouseout],[onmouseover],[onmouseup],[onwheel],[onpause],[onplay],[onplaying],[onprogress],[onratechange],[onreset],[onresize],[onscroll],[onseeked],[onseeking],[onselect],[onshow],[onstalled],[onsubmit],[onsuspend],[ontimeupdate],[ontoggle],[onvolumechange],[onwaiting],[onafterprint],[onbeforeprint],[onbeforeunload],[onhashchange],[onlanguagechange],[onmessage],[onoffline],[ononline],[onpagehide],[onpageshow],[onrejectionhandled],[onpopstate],[onstorage],[onunhandledrejection],[onunload],[oncopy],[oncut],[onpaste]') !== null
    ) {
        vAPI.messaging.send('contentscript.js', {
            what: 'securityPolicyViolation',
            directive: 'script-src',
            documentURI: window.location.href,
        });
    }

    if ( document.querySelector('style,[style]') !== null ) {
        vAPI.messaging.send('contentscript.js', {
            what: 'securityPolicyViolation',
            directive: 'style-src',
            documentURI: window.location.href,
        });
    }

    collapser.addMany(document.querySelectorAll('img'));
    collapser.addIFrames(document.querySelectorAll('iframe, frame'));
    collapser.process();
}

/******************************************************************************/
/******************************************************************************/

// Executed only once.

// https://github.com/gorhill/uMatrix/issues/232
//   Force `display` property, Firefox is still affected by the issue.

(( ) => {
    const noscripts = document.querySelectorAll('noscript');
    if ( noscripts.length === 0 ) { return; }

    const reMetaContent = /^\s*(\d+)\s*;\s*url=(['"]?)([^'"]+)\2/i;
    const reSafeURL = /^https?:\/\//;
    let redirectTimer;

    const autoRefresh = function(root) {
        const meta = root.querySelector('meta[http-equiv="refresh"][content]');
        if ( meta === null ) { return; }
        const match = reMetaContent.exec(meta.getAttribute('content'));
        if ( match === null || match[3].trim() === '' ) { return; }
        const url = new URL(match[3], document.baseURI);
        if ( reSafeURL.test(url.href) === false ) { return; }
        redirectTimer = setTimeout(
            ( ) => {
                location.assign(url.href);
            },
            parseInt(match[1], 10) * 1000 + 1
        );
        meta.parentNode.removeChild(meta);
    };

    const morphNoscript = function(from) {
        if ( /^application\/(?:xhtml\+)?xml/.test(document.contentType) ) {
            const to = document.createElement('span');
            while ( from.firstChild !== null ) {
                to.appendChild(from.firstChild);
            }
            return to;
        }
        const parser = new DOMParser();
        const doc = parser.parseFromString(
            '<span>' + from.textContent + '</span>',
            'text/html'
        );
        return document.adoptNode(doc.querySelector('span'));
    };

    const renderNoscriptTags = function(response) {
        if ( response !== true ) { return; }
        for ( var noscript of noscripts ) {
            const parent = noscript.parentNode;
            if ( parent === null ) { continue; }
            const span = morphNoscript(noscript);
            span.style.setProperty('display', 'inline', 'important');
            if ( redirectTimer === undefined ) {
                autoRefresh(span);
            }
            parent.replaceChild(span, noscript);
        }
    };

    vAPI.messaging.send('contentscript.js', {
        what: 'mustRenderNoscriptTags?',
    }).then(response => {
        renderNoscriptTags(response);
    });
})();

/******************************************************************************/
/******************************************************************************/

vAPI.messaging.send('contentscript.js', {
    what: 'shutdown?',
}).then(response => {
    if ( response === true ) {
        vAPI.shutdown.exec();
    }
});

/******************************************************************************/
/******************************************************************************/

})();
