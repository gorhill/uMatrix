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

var inspectedTabId = '';
var doc = document;
var body = doc.body;
var tbody = doc.querySelector('#content tbody');
var trJunkyard = [];
var tdJunkyard = [];
var firstVarDataCol = 2;  // currently, column 2 (0-based index)
var lastVarDataIndex = 3; // currently, d0-d3
var maxEntries = 5000;
var noTabId = '';
var popupTabId;

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

var createGap = function(url) {
    var tr = createRow('1');
    tr.classList.add('doc');
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
        // If the request is that of a root frame, insert a gap in the table
        // in order to visually separate entries for different documents. 
        if ( entry.d2 === 'doc' ) {
            createGap(entry.d1);
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

    if ( entry.tab === noTabId ) {
        tr.classList.add('tab_bts');
    } else if ( entry.tab !== '' ) {
        tr.classList.add('tab_' + entry.tab);
    }
    if ( entry.cat !== '' ) {
        tr.classList.add('cat_' + entry.cat);
    }

    tbody.insertBefore(tr, tbody.firstChild);
};

/******************************************************************************/

var renderLogBuffer = function(response) {
    var buffer = response.entries;
    if ( buffer.length === 0 ) {
        return;
    }

    noTabId = response.noTabId;

    // Preserve scroll position
    var height = tbody.offsetHeight;

    var n = buffer.length;
    for ( var i = 0; i < n; i++ ) {
        renderLogEntry(buffer[i]);
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
    size = Math.min(size, 5000);
    var tr;
    while ( tbody.childElementCount > size ) {
        tr = tbody.lastElementChild;
        trJunkyard.push(tbody.removeChild(tr));
    }
};

/******************************************************************************/

var onBufferRead = function(response) {
    if ( response.maxLoggedRequests !== maxEntries ) {
        maxEntries = response.maxLoggedRequests;
        uDom('#maxEntries').val(maxEntries || '');
    }
    renderLogBuffer(response);
    setTimeout(readLogBuffer, 1000);
};

/******************************************************************************/

// This can be called only once, at init time. After that, this will be called
// automatically. If called after init time, this will be messy, and this would
// require a bit more code to ensure no multi time out events.

var readLogBuffer = function() {
    messager.send({ what: 'readMany', tabId: inspectedTabId }, onBufferRead);
};

/******************************************************************************/

var clearBuffer = function() {
    var tr;
    while ( tbody.firstChild !== null ) {
        tr = tbody.lastElementChild;
        trJunkyard.push(tbody.removeChild(tr));
    }
};

/******************************************************************************/

var toggleCompactView = function() {
    body.classList.toggle(
        'compactView',
        body.classList.contains('compactView') === false
    );
};

/******************************************************************************/

var togglePopup = (function() {
    var container = null;
    var movingOverlay = null;
    var popup = null;
    var popupObserver = null;
    var style = null;
    var styleTemplate = 'tr:not(.tab_{{tabId}}) { opacity: 0.1; }';
    var dx, dy;

    var moveTo = function(ev) {
        container.style.left = (ev.clientX + dx) + 'px';
        container.style.top = (ev.clientY + dy) + 'px';
    };

    var onMouseMove = function(ev) {
        moveTo(ev);
        ev.stopPropagation();
        ev.preventDefault();
    };

    var onMouseUp = function(ev) {
        moveTo(ev);
        movingOverlay.removeEventListener('mouseup', onMouseUp);
        movingOverlay.removeEventListener('mousemove', onMouseMove);
        movingOverlay = null;
        container.classList.remove('moving');
        var rect = container.getBoundingClientRect();
        vAPI.localStorage.setItem('popupLastPosition', JSON.stringify({
            x: rect.left,
            y: rect.top
        }));
        ev.stopPropagation();
        ev.preventDefault();
    };

    var onMove = function(ev) {
        container.classList.add('moving');
        var rect = container.getBoundingClientRect();
        dx = rect.left - ev.clientX;
        dy = rect.top - ev.clientY;
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
        var tabId = matches[1];
        if ( tabId === 'bts' ) {
            tabId = noTabId;
        }

        // Use last position if one is defined
        var x, y;
        var json = vAPI.localStorage.getItem('popupLastPosition');
        if ( json ) {
            try {
                var popupLastPosition = JSON.parse(json);
                x = popupLastPosition.x;
                y = popupLastPosition.y;
            }
            catch (e) {
            }
        }
        // Fall back to cell position if no position defined
        if ( x === undefined ) {
            var rect = td.getBoundingClientRect();
            x = rect.left;
            y = rect.bottom;
        }
        container = document.getElementById('popupContainer');
        container.style.left = x + 'px';
        container.style.top = y + 'px';
        container.addEventListener('mousedown', onMove);
        popup = container.querySelector('iframe');
        popup.setAttribute('src', 'popup.html?tabId=' + tabId);
        popup.addEventListener('load', onLoad);
        popupObserver = new MutationObserver(resizePopup);
        style = document.querySelector('#content > style');
        style.textContent = styleTemplate.replace('{{tabId}}', tabId);
        container.classList.add('show');
        popupTabId = tabId;
    };

    var toggleOff = function() {
        style.textContent = '';
        style = null;
        popupObserver.disconnect();
        popupObserver = null;
        popup.removeEventListener('load', onLoad);
        popup.setAttribute('src', '');
        popup = null;
        container.classList.remove('show');
        container.removeEventListener('mousedown', onMove);
        container = null;
        popupTabId = undefined;
    };

    return function(ev) {
        if ( popupTabId !== undefined ) {
            toggleOff();
        } else {
            toggleOn(ev.target);
        }
    };
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
    // Extract the tab id of the page we need to pull the log
    var matches = window.location.search.match(/[\?&]tabId=([^&]+)/);
    if ( matches && matches.length === 2 ) {
        inspectedTabId = matches[1];
    }

    readLogBuffer();

    uDom('#compactViewToggler').on('click', toggleCompactView);
    uDom('#clear').on('click', clearBuffer);
    uDom('#maxEntries').on('change', onMaxEntriesChanged);
    uDom('#content table').on('click', 'tr.cat_net > td:nth-of-type(2)', togglePopup);
    uDom('#focusOverlay').on('click', togglePopup);
});

/******************************************************************************/

})();
