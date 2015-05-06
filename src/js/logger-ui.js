/*******************************************************************************

    uMatrix - a browser extension to benchmark browser session.
    Copyright (C) 2015 Raymond Hill

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

    Home: https://github.com/gorhill/sessbench

    TODO: cleanup/refactor
*/

/* jshint boss: true */
/* global vAPI, uDom */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var messager = vAPI.messaging.channel('logger-ui.js');

var doc = document;
var body = doc.body;
var tbody = doc.querySelector('#content tbody');
var trJunkyard = [];
var tdJunkyard = [];
var firstVarDataCol = 2;  // currently, column 2 (0-based index)
var lastVarDataIndex = 3; // currently, d0-d3
var maxEntries = 5000;
var noTabId = '';
var allTabIds = {};

var prettyRequestTypes = {
    'main_frame': 'doc',
    'stylesheet': 'css',
    'sub_frame': 'frame',
    'xmlhttprequest': 'xhr'
};

var timeOptions = {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
};

var dateOptions = {
    month: 'short',
    day: '2-digit'
};

/******************************************************************************/

var escapeHTML = function(s) {
    return s.replace(reEscapeLeftBracket, '&lt;')
            .replace(reEscapeRightBracket, '&gt;');
};

var reEscapeLeftBracket = /</g;
var reEscapeRightBracket = />/g;

/******************************************************************************/

// Emphasize hostname in URL, as this is what matters in uMatrix's rules.

var nodeFromURL = function(url) {
    var hnbeg = url.indexOf('://');
    if ( hnbeg === -1 ) {
        return document.createTextNode(url);
    }
    hnbeg += 3;

    var hnend = url.indexOf('/', hnbeg);
    if ( hnend === -1 ) {
        hnend = url.slice(hnbeg).search(/\?#/);
        if ( hnend !== -1 ) {
            hnend += hnbeg;
        } else {
            hnend = url.length;
        }
    }

    var node = renderedURLTemplate.cloneNode(true);
    node.childNodes[0].textContent = url.slice(0, hnbeg);
    node.childNodes[1].textContent = url.slice(hnbeg, hnend);
    node.childNodes[2].textContent = url.slice(hnend);
    return node;
};

var renderedURLTemplate = document.querySelector('#renderedURLTemplate > span');

/******************************************************************************/

var createCellAt = function(tr, index) {
    var td = tr.cells[index];
    var mustAppend = !td;
    if ( mustAppend ) {
        td = tdJunkyard.pop();
    }
    if ( td ) {
        td.removeAttribute('colspan');
        td.textContent = '';
    } else {
        td = doc.createElement('td');
    }
    if ( mustAppend ) {
        tr.appendChild(td);
    }
    return td;
};

/******************************************************************************/

var createRow = function(layout) {
    var tr = trJunkyard.pop();
    if ( tr ) {
        tr.className = '';
    } else {
        tr = doc.createElement('tr');
    }
    for ( var index = 0; index < firstVarDataCol; index++ ) {
        createCellAt(tr, index);
    }
    var i = 1, span = 1, td;
    for (;;) {
        td = createCellAt(tr, index);
        if ( i === lastVarDataIndex ) {
            break;
        }
        if ( layout.charAt(i) !== '1' ) {
            span += 1;
        } else {
            if ( span !== 1 ) {
                td.setAttribute('colspan', span);
            }
            index += 1;
            span = 1;
        }
        i += 1;
    }
    if ( span !== 1 ) {
        td.setAttribute('colspan', span);
    }
    index += 1;
    while ( td = tr.cells[index] ) {
        tdJunkyard.push(tr.removeChild(td));
    }
    return tr;
};

/******************************************************************************/

var createGap = function(tabId, url) {
    var tr = createRow('1');
    tr.classList.add('doc');
    tr.classList.add('tab');
    tr.classList.add('canMtx');
    tr.classList.add('tab_' + tabId);
    tr.cells[firstVarDataCol].textContent = url;
    tbody.insertBefore(tr, tbody.firstChild);
};

/******************************************************************************/

var renderLogEntry = function(entry) {
    var tr;
    var fvdc = firstVarDataCol;

    switch ( entry.cat ) {
    case 'error':
    case 'info':
        tr = createRow('1');
        tr.cells[fvdc].textContent = entry.d0;
        break;

    case 'net':
        tr = createRow('111');
        tr.classList.add('canMtx');
        // If the request is that of a root frame, insert a gap in the table
        // in order to visually separate entries for different documents. 
        if ( entry.d2 === 'doc' && entry.tab !== noTabId ) {
            createGap(entry.tab, entry.d1);
        }
        if ( entry.d3 ) {
            tr.classList.add('blocked');
            tr.cells[fvdc].textContent = '---';
        } else {
            tr.cells[fvdc].textContent = '';
        }
        tr.cells[fvdc+1].textContent = (prettyRequestTypes[entry.d2] || entry.d2);
        tr.cells[fvdc+2].appendChild(nodeFromURL(entry.d1));
        break;

    default:
        tr = createRow('1');
        tr.cells[fvdc].textContent = entry.d0;
        break;
    }

    // Fields common to all rows.
    var time = new Date(entry.tstamp);
    tr.cells[0].textContent = time.toLocaleTimeString('fullwide', timeOptions);
    tr.cells[0].title = time.toLocaleDateString('fullwide', dateOptions);

    if ( entry.tab ) {
        tr.classList.add('tab');
        if ( entry.tab === noTabId ) {
            tr.classList.add('tab_bts');
        } else if ( entry.tab !== '' ) {
            tr.classList.add('tab_' + entry.tab);
        }
    }
    if ( entry.cat !== '' ) {
        tr.classList.add('cat_' + entry.cat);
    }

    tbody.insertBefore(tr, tbody.firstChild);
};

/******************************************************************************/

var renderLogEntries = function(response) {
    var entries = response.entries;
    if ( entries.length === 0 ) {
        return;
    }

    // Preserve scroll position
    var height = tbody.offsetHeight;

    var tabIds = response.tabIds;
    var n = entries.length;
    var entry;
    for ( var i = 0; i < n; i++ ) {
        entry = entries[i];
        // Unlikely, but it may happen
        if ( entry.tab && tabIds.hasOwnProperty(entry.tab) === false ) {
            continue;
        }
        renderLogEntry(entries[i]);
    }

    // Prevent logger from growing infinitely and eating all memory. For
    // instance someone could forget that it is left opened for some
    // dynamically refreshed pages.
    truncateLog(maxEntries);

    var yDelta = tbody.offsetHeight - height;
    if ( yDelta === 0 ) {
        return;
    }

    // Chromium:
    //   body.scrollTop = good value
    //   body.parentNode.scrollTop = 0
    if ( body.scrollTop !== 0 ) {
        body.scrollTop += yDelta;
        return;
    }

    // Firefox:
    //   body.scrollTop = 0
    //   body.parentNode.scrollTop = good value
    var parentNode = body.parentNode;
    if ( parentNode && parentNode.scrollTop !== 0 ) {
        parentNode.scrollTop += yDelta;
    }
};

/******************************************************************************/

var truncateLog = function(size) {
    if ( size === 0 ) {
        size = 5000;
    }
    size = Math.min(size, 10000);
    var tr;
    while ( tbody.childElementCount > size ) {
        tr = tbody.lastElementChild;
        trJunkyard.push(tbody.removeChild(tr));
    }
};

/******************************************************************************/

var onLogBufferRead = function(response) {
    // This tells us the behind-the-scene tab id
    noTabId = response.noTabId;

    // This may have changed meanwhile
    if ( response.maxLoggedRequests !== maxEntries ) {
        maxEntries = response.maxLoggedRequests;
        uDom('#maxEntries').val(maxEntries || '');
    }

    // Neuter rows for which a tab does not exist anymore
    // TODO: sort to avoid using indexOf
    var rowVoided = false;
    for ( var tabId in allTabIds ) {
        if ( allTabIds.hasOwnProperty(tabId) === false ) {
            continue;
        }
        if ( response.tabIds.hasOwnProperty(tabId) ) {
            continue;
        }
        uDom('.tab_' + tabId).removeClass('canMtx');
        if ( tabId === popupManager.tabId ) {
            popupManager.toggleOff();
        }
        rowVoided = true;
    }
    allTabIds = response.tabIds;

    renderLogEntries(response);

    if ( rowVoided ) {
        uDom('#clean').toggleClass(
            'disabled',
            tbody.querySelector('tr.tab:not(.canMtx)') === null
        );
    }

    // Synchronize toolbar with content of log
    uDom('#clear').toggleClass(
        'disabled',
        tbody.querySelector('tr') === null
    );

    setTimeout(readLogBuffer, 1200);
};

/******************************************************************************/

// This can be called only once, at init time. After that, this will be called
// automatically. If called after init time, this will be messy, and this would
// require a bit more code to ensure no multi time out events.

var readLogBuffer = function() {
    messager.send({ what: 'readMany' }, onLogBufferRead);
};

/******************************************************************************/

var clearBuffer = function() {
    var tr;
    while ( tbody.firstChild !== null ) {
        tr = tbody.lastElementChild;
        trJunkyard.push(tbody.removeChild(tr));
    }
    uDom('#clear').addClass('disabled');
    uDom('#clean').addClass('disabled');
};

/******************************************************************************/

var cleanBuffer = function() {
    var rows = uDom('#content tr.tab:not(.canMtx)').remove();
    var i = rows.length;
    while ( i-- ) {
        trJunkyard.push(rows.nodeAt(i));
    }
    uDom('#clean').addClass('disabled');
};

/******************************************************************************/

var toggleCompactView = function() {
    body.classList.toggle(
        'compactView',
        body.classList.contains('compactView') === false
    );
};

/******************************************************************************/

var popupManager = (function() {
    var realTabId = null;
    var localTabId = null;
    var container = null;
    var movingOverlay = null;
    var popup = null;
    var popupObserver = null;
    var style = null;
    var styleTemplate = [
        'tr:not(.tab_{{tabId}}) {',
            'cursor: not-allowed;',
            'opacity: 0.2;',
        '}'
    ].join('\n');

    // Related to moving the popup around
    var xnormal, ynormal, crect, dx, dy, vw, vh;

    // Viewport data assumed to be properly set up
    var positionFromNormal = function(x, y) {
        if ( typeof x === 'number' ) {
            if ( x < 0.5 ) {
                container.style.setProperty('left', (x * vw) + 'px');
                container.style.removeProperty('right');
            } else {
                container.style.removeProperty('left');
                container.style.setProperty('right', ((1 - x) * vw) + 'px');
            }
        }
        if ( typeof y === 'number' ) {
            if ( y < 0.5 ) {
                container.style.setProperty('top', (y * vh) + 'px');
                container.style.removeProperty('bottom');
            } else {
                container.style.removeProperty('top');
                container.style.setProperty('bottom', ((1 - y) * vh) + 'px');
            }
        }
        // TODO: adjust size
    };
    var updateViewportData = function() {
        crect = container.getBoundingClientRect();
        vw = document.documentElement.clientWidth - crect.width;
        vh = document.documentElement.clientHeight - crect.height;
    };
    var toNormalX = function(x) {
        return xnormal = Math.max(Math.min(x / vw, 1), 0);
    };
    var toNormalY = function(y) {
        return ynormal = Math.max(Math.min(y / vh, 1), 0);
    };

    var onMouseMove = function(ev) {
        updateViewportData();
        positionFromNormal(
            toNormalX(ev.clientX + dx),
            toNormalY(ev.clientY + dy)
        );
        ev.stopPropagation();
        ev.preventDefault();
    };

    var onMouseUp = function(ev) {
        updateViewportData();
        positionFromNormal(
            toNormalX(ev.clientX + dx),
            toNormalY(ev.clientY + dy)
        );
        movingOverlay.removeEventListener('mouseup', onMouseUp);
        movingOverlay.removeEventListener('mousemove', onMouseMove);
        movingOverlay = null;
        container.classList.remove('moving');
        vAPI.localStorage.setItem('popupLastPosition', JSON.stringify({
            xnormal: xnormal,
            ynormal: ynormal
        }));
        ev.stopPropagation();
        ev.preventDefault();
    };

    var onMouseDown = function(ev) {
        if ( ev.target !== ev.currentTarget ) {
            return;
        }
        container.classList.add('moving');
        updateViewportData();
        dx = crect.left - ev.clientX;
        dy = crect.top - ev.clientY;
        movingOverlay = document.getElementById('movingOverlay');
        movingOverlay.addEventListener('mousemove', onMouseMove, true);
        movingOverlay.addEventListener('mouseup', onMouseUp, true);
        ev.stopPropagation();
        ev.preventDefault();
    };

    var resizePopup = function() {
        var popupBody = popup.contentWindow.document.body;
        if ( popupBody.clientWidth !== 0 && container.clientWidth !== popupBody.clientWidth ) {
            container.style.width = popupBody.clientWidth + 'px';
        }
        if ( popupBody.clientHeight !== 0 && popup.clientHeight !== popupBody.clientHeight ) {
            popup.style.height = popupBody.clientHeight + 'px';
        }
    };

    var onLoad = function() {
        resizePopup();
        popupObserver.observe(popup.contentDocument.body, {
            subtree: true,
            attributes: true
        });
    };

    var toggleOn = function(td) {
        var tr = td.parentNode;
        var matches = tr.className.match(/(?:^| )tab_([^ ]+)/);
        if ( matches === null ) {
            return;
        }
        realTabId = localTabId = matches[1];
        if ( localTabId === 'bts' ) {
            realTabId = noTabId;
        }

        // Use last normalized position if one is defined.
        // Default to top-right.
        var x = 1, y = 0;
        var json = vAPI.localStorage.getItem('popupLastPosition');
        if ( json ) {
            try {
                var popupLastPosition = JSON.parse(json);
                x = popupLastPosition.xnormal;
                y = popupLastPosition.ynormal;
            }
            catch (e) {
            }
        }
        container = document.getElementById('popupContainer');
        updateViewportData();
        positionFromNormal(x, y);

        // Window controls
        container.querySelector('div > span:first-child').addEventListener('click', toggleOff);
        container.querySelector('div').addEventListener('mousedown', onMouseDown);

        popup = document.createElement('iframe');
        popup.addEventListener('load', onLoad);
        popup.setAttribute('src', 'popup.html?tabId=' + realTabId);
        popupObserver = new MutationObserver(resizePopup);
        container.appendChild(popup);

        style = document.querySelector('#content > style');
        style.textContent = styleTemplate.replace('{{tabId}}', localTabId);

        document.body.classList.add('popupOn');
    };

    var toggleOff = function() {
        document.body.classList.remove('popupOn');

        // Just in case
        if ( movingOverlay !== null ) {
            movingOverlay.removeEventListener('mousemove', onMouseMove, true);
            movingOverlay.removeEventListener('mouseup', onMouseUp, true);
            movingOverlay = null;
        }

        // Window controls
        container.querySelector('div > span:first-child').removeEventListener('click', toggleOff);
        container.querySelector('div').removeEventListener('mousedown', onMouseDown);

        popup.removeEventListener('load', onLoad);
        popupObserver.disconnect();
        popupObserver = null;
        popup.setAttribute('src', '');
        container.removeChild(popup);
        popup = null;

        style.textContent = '';
        style = null;

        container = null;
        realTabId = null;
    };

    var exports = {
        toggleOn: function(ev) {
            if ( realTabId === null ) {
                toggleOn(ev.target);
            }
        },
        toggleOff: function() {
            if ( realTabId !== null ) {
                toggleOff();
            }
        }
    };

    Object.defineProperty(exports, 'tabId', {
        get: function() { return realTabId || 0; }
    });

    return exports;
})();

/******************************************************************************/

var onMaxEntriesChanged = function() {
    var raw = uDom(this).val();
    try {
        maxEntries = parseInt(raw, 10);
        if ( isNaN(maxEntries) ) {
            maxEntries = 0;
        }
    } catch (e) {
        maxEntries = 0;
    }

    messager.send({
        what: 'userSettings',
        name: 'maxLoggedRequests',
        value: maxEntries
    });

    truncateLog(maxEntries);
};

/******************************************************************************/

uDom.onLoad(function() {
    readLogBuffer();

    uDom('#compactViewToggler').on('click', toggleCompactView);
    uDom('#clean').on('click', cleanBuffer);
    uDom('#clear').on('click', clearBuffer);
    uDom('#maxEntries').on('change', onMaxEntriesChanged);
    uDom('#content table').on('click', 'tr.canMtx > td:nth-of-type(2)', popupManager.toggleOn);
});

/******************************************************************************/

})();
