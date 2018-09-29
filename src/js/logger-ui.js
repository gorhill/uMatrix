/*******************************************************************************

    uMatrix - a browser extension to benchmark browser session.
    Copyright (C) 2015-present Raymond Hill

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
*/

/* global publicSuffixList, uDom, uMatrixScopeWidget */

'use strict';

/******************************************************************************/

(function() {

/******************************************************************************/

var tbody = document.querySelector('#content tbody');
var trJunkyard = [];
var tdJunkyard = [];
var firstVarDataCol = 1;  // currently, column 2 (0-based index)
var lastVarDataIndex =
    document.querySelector('#content colgroup').childElementCount - 1;
var maxEntries = 0;
var noTabId = '';
var pageStores = new Map();
var pageStoresToken;
var ownerId = Date.now();

var emphasizeTemplate = document.querySelector('#emphasizeTemplate > span');

var prettyRequestTypes = {
    'main_frame': 'doc',
    'stylesheet': 'css',
    'sub_frame': 'frame',
    'xmlhttprequest': 'xhr'
};

var dontEmphasizeSet = new Set([
    'COOKIE',
    'CSP',
    'REFERER'
]);

/******************************************************************************/

// Adjust top padding of content table, to match that of toolbar height.

document.getElementById('content').style.setProperty(
    'margin-top',
    document.getElementById('toolbar').clientHeight + 'px'
);

/******************************************************************************/

let removeChildren = function(node) {
    while ( node.firstChild ) {
        node.removeChild(node.firstChild);
    }
};

let removeSelf = function(node) {
    let parent = node && node.parentNode;
    if ( parent ) {
        parent.removeChild(node);
    }
};

let prependChild = function(parent, child) {
    parent.insertBefore(child, parent.firstElementChild);
};

/******************************************************************************/

// We will lookup domains locally.

let domainFromSrcHostname = (function() {
    let srcHn = '', srcDn = '';
    return function(hn) {
        if ( hn !== srcHn ) {
            srcHn = hn;
            srcDn = publicSuffixList.getDomain(hn);
        }
        return srcDn;
    };
})();

let domainFromDesHostname = (function() {
    let desHn = '', desDn = '';
    return function(hn) {
        if ( hn !== desHn ) {
            desHn = hn;
            desDn = publicSuffixList.getDomain(hn);
        }
        return desDn;
     };
})();

let is3rdParty = function(srcHn, desHn) {
    return domainFromSrcHostname(srcHn) !== domainFromDesHostname(desHn);
};

vAPI.messaging.send(
    'logger-ui.js',
    { what: 'getPublicSuffixListData' },
    response => {
        publicSuffixList.fromSelfie(response);
    }
);

/******************************************************************************/

// Emphasize hostname and cookie name.

var emphasizeCookie = function(s) {
    var pnode = emphasizeHostname(s);
    if ( pnode.childNodes.length !== 3 ) {
        return pnode;
    }
    var prefix = '-cookie:';
    var text = pnode.childNodes[2].textContent;
    var beg = text.indexOf(prefix);
    if ( beg === -1 ) {
        return pnode;
    }
    beg += prefix.length;
    var end = text.indexOf('}', beg);
    if ( end === -1 ) {
        return pnode;
    }
    var cnode = emphasizeTemplate.cloneNode(true);
    cnode.childNodes[0].textContent = text.slice(0, beg);
    cnode.childNodes[1].textContent = text.slice(beg, end);
    cnode.childNodes[2].textContent = text.slice(end);
    pnode.replaceChild(cnode.childNodes[0], pnode.childNodes[2]);
    pnode.appendChild(cnode.childNodes[0]);
    pnode.appendChild(cnode.childNodes[0]);
    return pnode;
};

/******************************************************************************/

// Emphasize hostname in URL.

var emphasizeHostname = function(url) {
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

    var node = emphasizeTemplate.cloneNode(true);
    node.childNodes[0].textContent = url.slice(0, hnbeg);
    node.childNodes[1].textContent = url.slice(hnbeg, hnend);
    node.childNodes[2].textContent = url.slice(hnend);
    return node;
};

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
        td = document.createElement('td');
    }
    if ( mustAppend ) {
        tr.appendChild(td);
    }
    return td;
};

/******************************************************************************/

var createRow = function(layout) {
    let tr = trJunkyard.pop();
    if ( tr ) {
        tr.className = '';
    } else {
        tr = document.createElement('tr');
    }
    let index;
    for ( index = 0; index < firstVarDataCol; index++ ) {
        createCellAt(tr, index);
    }
    let i = 1, span = 1;
    let td;
    for (;;) {
        td = createCellAt(tr, index);
        if ( i === lastVarDataIndex ) { break; }
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
    for (;;) {
        td = tr.cells[index];
        if ( !td ) { break; }
        tdJunkyard.push(tr.removeChild(td));
    }
    tr.removeAttribute('data-tabid');
    tr.removeAttribute('data-srchn');
    tr.removeAttribute('data-deshn');
    tr.removeAttribute('data-type');
    return tr;
};

/******************************************************************************/

var padTo2 = function(v) {
    return v < 10 ? '0' + v : v;
};

/******************************************************************************/

var createGap = function(tabId, url) {
    var tr = createRow('1');
    tr.classList.add('doc');
    tr.classList.add('tab');
    tr.classList.add('canMtx');
    tr.setAttribute('data-tabid', tabId);
    tr.cells[firstVarDataCol].textContent = url;
    tbody.insertBefore(tr, tbody.firstChild);
};

/******************************************************************************/

var renderLogEntry = function(entry) {
    let details;
    try {
        details = JSON.parse(entry.details);
    } catch(ex) {
        console.error(ex);
    }
    if ( details instanceof Object === false ) { return; }

    let tr;
    let fvdc = firstVarDataCol;

    if ( details.error !== undefined ) {
        tr = createRow('1');
        tr.classList.add('cat_error');
        tr.cells[fvdc].textContent = details.error;
    } else if ( details.info !== undefined ) {
        tr = createRow('1');
        tr.classList.add('cat_info');
        if ( details.prettify === 'cookie' ) {
            tr.cells[fvdc].appendChild(emphasizeCookie(details.info));
        } else {
            tr.cells[fvdc].textContent = details.info;
        }
    } else if ( details.srcHn !== undefined && details.desHn !== undefined ) {
        tr = createRow('11111');
        tr.classList.add('canMtx');
        tr.classList.add('cat_net');
        tr.setAttribute('data-srchn', details.srcHn);
        tr.setAttribute('data-deshn', details.desHn);
        tr.setAttribute('data-type', details.type);
        // If the request is that of a root frame, insert a gap in the table
        // in order to visually separate entries for different documents. 
        if ( details.type === 'doc' && details.tabId !== noTabId ) {
            createGap(details.tabId, details.desURL);
        }
        tr.cells[fvdc+0].textContent = details.srcHn;
        if ( details.blocked ) {
            tr.classList.add('blocked');
            tr.cells[fvdc+1].textContent = '--';
        } else {
            tr.cells[fvdc+1].textContent = '';
        }
        tr.cells[fvdc+2].textContent =
            prettyRequestTypes[details.type] || details.type;
        if ( dontEmphasizeSet.has(details.type) ) {
            tr.cells[fvdc+3].textContent = details.desURL;
        } else {
            tr.cells[fvdc+3].appendChild(emphasizeHostname(details.desURL));
        }
        tr.cells[fvdc+4].textContent =
            is3rdParty(details.srcHn, details.desHn) ? '3p' : '';
    } else if ( details.header ) {
        tr = createRow('11111');
        tr.classList.add('canMtx');
        tr.classList.add('cat_net');
        tr.cells[fvdc+0].textContent = details.srcHn || '';
        if ( details.change === -1 ) {
            tr.classList.add('blocked');
            tr.cells[fvdc+1].textContent = '--';
        } else {
            tr.cells[fvdc+1].textContent = '';
        }
        tr.cells[fvdc+2].textContent = details.header.name;
        tr.cells[fvdc+3].textContent = details.header.value;
        tr.cells[fvdc+4].textContent = '';
    } else {
        tr = createRow('1');
        tr.cells[fvdc].textContent = 'huh?';
    }

    // Fields common to all rows.
    let time = logDate;
    time.setTime(entry.tstamp - logDateTimezoneOffset);
    tr.cells[0].textContent = padTo2(time.getUTCHours()) + ':' +
                              padTo2(time.getUTCMinutes()) + ':' +
                              padTo2(time.getSeconds());

    if ( details.tabId ) {
        tr.classList.add('tab');
        tr.setAttribute('data-tabid', details.tabId);
    } else {
        tr.removeAttribute('data-tabid');
    }

    rowFilterer.filterOne(tr, true);

    tbody.insertBefore(tr, tbody.firstChild);
};

// Reuse date objects.
var logDate = new Date(),
    logDateTimezoneOffset = logDate.getTimezoneOffset() * 60000;

/******************************************************************************/

var renderLogEntries = function(response) {
    let entries = response.entries;
    if ( entries.length === 0 ) { return; }

    // Preserve scroll position
    let height = tbody.offsetHeight;

    for ( let i = 0, n = entries.length; i < n; i++ ) {
        renderLogEntry(entries[i]);
    }

    // Prevent logger from growing infinitely and eating all memory. For
    // instance someone could forget that it is left opened for some
    // dynamically refreshed pages.
    truncateLog(maxEntries);

    let yDelta = tbody.offsetHeight - height;
    if ( yDelta === 0 ) { return; }

    // Chromium:
    //   body.scrollTop = good value
    //   body.parentNode.scrollTop = 0
    if ( document.body.scrollTop !== 0 ) {
        document.body.scrollTop += yDelta;
        return;
    }

    // Firefox:
    //   body.scrollTop = 0
    //   body.parentNode.scrollTop = good value
    let parentNode = document.body.parentNode;
    if ( parentNode && parentNode.scrollTop !== 0 ) {
        parentNode.scrollTop += yDelta;
    }
};

/******************************************************************************/

var synchronizeTabIds = function(newPageStores) {
    let oldPageStores = pageStores;
    let autoDeleteVoidRows = !!vAPI.localStorage.getItem('loggerAutoDeleteVoidRows');
    let rowVoided = false;
    for ( let tabId of oldPageStores.keys() ) {
        if ( newPageStores.has(tabId) ) { continue; }
        // Mark or remove voided rows
        let trs = uDom('[data-tabid="' + tabId + '"]');
        if ( autoDeleteVoidRows ) {
            toJunkyard(trs);
        } else {
            trs.removeClass('canMtx');
            rowVoided = true;
        }
    }

    let select = document.getElementById('pageSelector');
    let selectValue = select.value;
    let tabIds = Array.from(newPageStores.keys()).sort(function(a, b) {
        return newPageStores.get(a).localeCompare(newPageStores.get(b));
    });
    for ( var i = 0, j = 2; i < tabIds.length; i++ ) {
        let tabId = tabIds[i];
        if ( tabId === noTabId ) { continue; }
        let option = select.options[j];
        j += 1;
        if ( !option ) {
            option = document.createElement('option');
            select.appendChild(option);
        }
        option.textContent = newPageStores.get(tabId);
        option.value = tabId;
        if ( option.value === selectValue ) {
            option.setAttribute('selected', '');
        } else {
            option.removeAttribute('selected');
        }
    }
    while ( j < select.options.length ) {
        select.removeChild(select.options[j]);
    }
    if ( select.value !== selectValue ) {
        select.selectedIndex = 0;
        select.value = '';
        select.options[0].setAttribute('selected', '');
        pageSelectorChanged();
    }

    pageStores = newPageStores;

    return rowVoided;
};

/******************************************************************************/

var truncateLog = function(size) {
    if ( size === 0 ) {
        size = 5000;
    }
    var tbody = document.querySelector('#content tbody');
    size = Math.min(size, 10000);
    var tr;
    while ( tbody.childElementCount > size ) {
        tr = tbody.lastElementChild;
        trJunkyard.push(tbody.removeChild(tr));
    }
};

/******************************************************************************/

var onLogBufferRead = function(response) {
    if ( !response || response.unavailable ) {
        readLogBufferAsync();
        return;
    }

    // This tells us the behind-the-scene tab id
    noTabId = response.noTabId;

    // This may have changed meanwhile
    if ( response.maxLoggedRequests !== maxEntries ) {
        maxEntries = response.maxLoggedRequests;
        uDom('#maxEntries').val(maxEntries || '');
    }

    // Neuter rows for which a tab does not exist anymore
    var rowVoided = false;
    if ( response.pageStoresToken !== pageStoresToken ) {
        if ( Array.isArray(response.pageStores) ) {
            rowVoided = synchronizeTabIds(new Map(response.pageStores));
        }
        pageStoresToken = response.pageStoresToken;
    }

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

    readLogBufferAsync();
};

/******************************************************************************/

// This can be called only once, at init time. After that, this will be called
// automatically. If called after init time, this will be messy, and this would
// require a bit more code to ensure no multi time out events.

var readLogBuffer = function() {
    if ( ownerId === undefined ) { return; }
    vAPI.messaging.send(
        'logger-ui.js',
        {
            what: 'readMany',
            ownerId: ownerId,
            pageStoresToken: pageStoresToken
        },
        onLogBufferRead
    );
};

var readLogBufferAsync = function() {
    if ( ownerId === undefined ) { return; }
    vAPI.setTimeout(readLogBuffer, 1200);
};

/******************************************************************************/

var pageSelectorChanged = function() {
    let style = document.getElementById('tabFilterer');
    let tabId = document.getElementById('pageSelector').value;
    let sheet = style.sheet;
    while ( sheet.cssRules.length !== 0 )  {
        sheet.deleteRule(0);
    }
    if ( tabId.length !== 0 ) {
        sheet.insertRule(
            '#content table tr:not([data-tabid="' + tabId + '"]) { display: none; }',
            0
        );
    }
    uDom('#refresh').toggleClass('disabled', /^\d+$/.test(tabId) === false);
};

/******************************************************************************/

var refreshTab = function() {
    var tabClass = document.getElementById('pageSelector').value;
    var matches = tabClass.match(/^tab_(.+)$/);
    if ( matches === null ) { return; }
    if ( matches[1] === 'bts' ) { return; }
    vAPI.messaging.send(
        'logger-ui.js',
        { what: 'forceReloadTab', tabId: parseInt(matches[1], 10) }
    );
};

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

    vAPI.messaging.send('logger-ui.js', {
        what: 'userSettings',
        name: 'maxLoggedRequests',
        value: maxEntries
    });

    truncateLog(maxEntries);
};

/******************************************************************************/

var rowFilterer = (function() {
    var filters = [];

    var parseInput = function() {
        filters = [];

        var rawPart, hardBeg, hardEnd;
        var raw = uDom('#filterInput').val().trim();
        var rawParts = raw.split(/\s+/);
        var reStr, reStrs = [], not = false;
        var n = rawParts.length;
        for ( var i = 0; i < n; i++ ) {
            rawPart = rawParts[i];
            if ( rawPart.charAt(0) === '!' ) {
                if ( reStrs.length === 0 ) {
                    not = true;
                }
                rawPart = rawPart.slice(1);
            }
            hardBeg = rawPart.charAt(0) === '|';
            if ( hardBeg ) {
                rawPart = rawPart.slice(1);
            }
            hardEnd = rawPart.slice(-1) === '|';
            if ( hardEnd ) {
                rawPart = rawPart.slice(0, -1);
            }
            if ( rawPart === '' ) {
                continue;
            }
            // https://developer.mozilla.org/en/docs/Web/JavaScript/Guide/Regular_Expressions
            reStr = rawPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if ( hardBeg ) {
                reStr = '(?:^|\\s)' + reStr;
            }
            if ( hardEnd ) {
                reStr += '(?:\\s|$)';
            }
            reStrs.push(reStr);
            if ( i < (n - 1) && rawParts[i + 1] === '||' ) {
                i += 1;
                continue;
            }
            reStr = reStrs.length === 1 ? reStrs[0] : reStrs.join('|');
            filters.push({
                re: new RegExp(reStr, 'i'),
                r: !not
            });
            reStrs = [];
            not = false;
        }
    };

    var filterOne = function(tr, clean) {
        var ff = filters;
        var fcount = ff.length;
        if ( fcount === 0 && clean === true ) {
            return;
        }
        // do not filter out doc boundaries, they help separate important
        // section of log.
        var cl = tr.classList;
        if ( cl.contains('doc') ) {
            return;
        }
        if ( fcount === 0 ) {
            cl.remove('f');
            return;
        }
        var cc = tr.cells;
        var ccount = cc.length;
        var hit, j, f;
        // each filter expression must hit (implicit and-op)
        // if...
        //   positive filter expression = there must one hit on any field
        //   negative filter expression = there must be no hit on all fields
        for ( var i = 0; i < fcount; i++ ) {
            f = ff[i];
            hit = !f.r;
            for ( j = 0; j < ccount; j++ ) {
                if ( f.re.test(cc[j].textContent) ) {
                    hit = f.r;
                    break;
                }
            }
            if ( !hit ) {
                cl.add('f');
                return;
            }
        }
        cl.remove('f');
    };

    var filterAll = function() {
        // Special case: no filter
        if ( filters.length === 0 ) {
            uDom('#content tr').removeClass('f');
            return;
        }
        var tbody = document.querySelector('#content tbody');
        var rows = tbody.rows;
        var i = rows.length;
        while ( i-- ) {
            filterOne(rows[i]);
        }
    };

    var onFilterChangedAsync = (function() {
        var timer = null;
        var commit = function() {
            timer = null;
            parseInput();
            filterAll();
        };
        return function() {
            if ( timer !== null ) {
                clearTimeout(timer);
            }
            timer = vAPI.setTimeout(commit, 750);
        };
    })();

    var onFilterButton = function() {
        var cl = document.body.classList;
        cl.toggle('f', cl.contains('f') === false);
    };

    uDom('#filterButton').on('click', onFilterButton);
    uDom('#filterInput').on('input', onFilterChangedAsync);

    return {
        filterOne: filterOne,
        filterAll: filterAll
    };
})();

/******************************************************************************/
/******************************************************************************/

var ruleEditor = (function() {
    let ruleEditorNode = document.getElementById('ruleEditor');
    let ruleActionPicker = document.getElementById('ruleActionPicker');
    let listeners = [];

    let addListener = function(node, type, handler, bits) {
        let options;
        if ( typeof bits === 'number' && (bits & 0b11) !== 0 ) {
            options = {};
            if ( bits & 0b01 ) {
                options.capture = true;
            }
            if ( bits & 0b10 ) {
                options.passive = true;
            }
        }
        listeners.push({ node, type, handler, options });
        return node.addEventListener(type, handler, options);
    };

    let setup = function(details) {
        ruleEditorNode.setAttribute('data-tabid', details.tabId);
        ruleEditorNode.classList.toggle(
            'colorblind',
            details.options.colorBlindFriendly === true
        );

        // Initialize scope selector
        let srcDn = domainFromSrcHostname(details.srcHn);
        let scope = details.options.popupScopeLevel === '*' ?
            '*' :
            details.options.popupScopeLevel === 'domain' ?
                srcDn :
                details.srcHn;
        uMatrixScopeWidget.init(srcDn, details.srcHn, scope, ruleEditorNode);

        // Create rule rows
        let ruleWidgets = ruleEditorNode.querySelector('.ruleWidgets');
        removeChildren(ruleWidgets);
        let ruleWidgetTemplate =
            document.querySelector('#ruleRowTemplate .ruleRow');

        // Rules: specific to desHn, from broadest to narrowest
        let desHn = details.desHn;
        let desDn = domainFromDesHostname(desHn);
        for (;;) {
            let ruleRow = ruleWidgetTemplate.cloneNode(true);
            ruleRow.setAttribute('data-deshn', desHn);
            ruleRow.children[0].textContent = desHn;
            ruleRow.children[1].setAttribute('data-type', details.type);
            if ( desHn === details.desHn ) {
                ruleRow.children[1].textContent = '1';
            }
            prependChild(ruleWidgets, ruleRow);
            if ( desHn === desDn ) { break; }
            let pos = desHn.indexOf('.');
            if ( pos === -1 ) { break; }
            desHn = desHn.slice(pos + 1);
        }

        // Rules: 1st-party, if needed
        if ( desDn === srcDn ) {
            let ruleRow = ruleWidgetTemplate.cloneNode(true);
            ruleRow.setAttribute('data-deshn', '1st-party');
            ruleRow.children[0].textContent = '1st-party';
            ruleRow.children[1].setAttribute('data-type', details.type);
            prependChild(ruleWidgets, ruleRow);
        }

        // Rules: unspecific
        {
            let ruleRow = ruleWidgetTemplate.cloneNode(true);
            ruleRow.setAttribute('data-deshn', '*');
            ruleRow.children[0].textContent = 'all';
            ruleRow.children[1].setAttribute('data-type', details.type);
            ruleRow.children[1].textContent = details.type;
            prependChild(ruleWidgets, ruleRow);
        }

        colorize();

        addListener(ruleEditorNode, 'click', quitHandler, 0b01);
        addListener(window, 'uMatrixScopeWidgetChange', scopeChangeHandler);
        addListener(ruleWidgets, 'mouseenter', attachRulePicker, 0b11);
        addListener(ruleWidgets, 'mouseleave', removeRulePicker, 0b11);
        addListener(ruleActionPicker, 'click', rulePickerHandler, 0b11);
        addListener(ruleEditorNode.querySelector('.buttonReload'), 'click', reload);
        addListener(ruleEditorNode.querySelector('.buttonRevertScope'), 'click', revert);
        addListener(ruleEditorNode.querySelector('.buttonPersist'), 'click', persist);

        document.body.appendChild(ruleEditorNode);
    };

    let colorize = function() {
        let srcHn = uMatrixScopeWidget.getScope();
        let ruleCells = ruleEditorNode.querySelectorAll('.ruleCell');
        let ruleParts = [];
        for ( let ruleCell of ruleCells ) {
            ruleParts.push(
                srcHn,
                ruleCell.closest('.ruleRow').getAttribute('data-deshn'),
                ruleCell.getAttribute('data-type')
            );
        }
        vAPI.messaging.send(
            'default',
            { what: 'getCellColors', ruleParts },
            response => {
                let tColors = response.tColors,
                    pColors = response.pColors,
                    diffCount = 0;
                for ( let i = 0; i < ruleCells.length; i++ ) {
                    let ruleCell = ruleCells[i];
                    let tColor = tColors[i];
                    let pColor = pColors[i];
                    ruleCell.setAttribute('data-tcolor', tColor);
                    ruleCell.setAttribute('data-pcolor', pColor);
                    if ( tColor === pColor ) { continue; }
                    if ( tColor < 128 && pColor < 128 ) { continue; }
                    diffCount += 1;
                }
                let dirty = diffCount !== 0;
                ruleEditorNode
                    .querySelector('.buttonPersist .badge')
                    .textContent = dirty ? diffCount : '';
                ruleEditorNode
                    .querySelector('.buttonRevertScope')
                    .classList
                    .toggle('disabled', !dirty);
                ruleEditorNode
                    .querySelector('.buttonPersist')
                    .classList
                    .toggle('disabled', !dirty);
            }
        );
    };

    let quitHandler = function(ev) {
        let target = ev.target;
        if ( target.classList.contains('modalDialog') ) {
            stop();
        }
    };

    let scopeChangeHandler = function() {
        colorize();
    };

    let attachRulePicker = function(ev) {
        let target = ev.target;
        if (
            target instanceof HTMLElement === false ||
            target.classList.contains('ruleCell') === false
        ) {
            return;
        }
        target.appendChild(ruleActionPicker);
    };

    let removeRulePicker = function(ev) {
        let target = ev.target;
        if (
            target instanceof HTMLElement === false ||
            ruleActionPicker.closest('.ruleCell') === target.closest('.ruleCell')
        ) {
            return;
        }
        removeSelf(ruleActionPicker);
    };

    let rulePickerHandler = function(ev) {
        let action = ev.target.className;
        if ( action !== 'allowRule' && action !== 'blockRule' ) { return; }
        let cell = ev.target.closest('.ruleCell');
        if ( cell === null ) { return; }
        let row = cell.closest('.ruleRow');
        let desHn = row.getAttribute('data-deshn');
        let type = cell.getAttribute('data-type');
        let color = parseInt(cell.getAttribute('data-tcolor'), 10);
        let what;
        if ( color === 1 || color === 2 ) {
            what = action === 'blockRule' ?
                'blacklistMatrixCell' :
                'whitelistMatrixCell';
        } else if ( desHn === '*' && type === '*' ) {
            what = color === 130 ?
                'blacklistMatrixCell' :
                'whitelistMatrixCell';
        } else {
            what = 'graylistMatrixCell';
        }
        let request = {
            what,
            srcHostname: uMatrixScopeWidget.getScope(),
            desHostname: desHn,
            type
        };
        vAPI.messaging.send('default', request, colorize);
    };


    let reload = function(ev) {
        vAPI.messaging.send('default', {
            what: 'forceReloadTab',
            tabId: parseInt(ruleEditorNode.getAttribute('data-tabid'), 10),
            bypassCache: ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey)
        });
    };

    let diff = function() {
        let entries = [];
        let cells = ruleEditorNode.querySelectorAll('.ruleCell');
        let srcHn = uMatrixScopeWidget.getScope();
        for ( let cell of cells ) {
            let tColor = cell.getAttribute('data-tcolor');
            let pColor = cell.getAttribute('data-pcolor');
            if ( tColor === pColor || tColor < 128 && pColor < 128 ) {
                continue;
            }
            let row = cell.closest('.ruleRow');
            entries.push({
                srcHn,
                desHn: row.getAttribute('data-deshn'),
                type: cell.getAttribute('data-type')
            });
        }
        return entries;
    };

    let persist = function() {
        let entries = diff();
        if ( entries.length === 0 ) { return; }
        vAPI.messaging.send(
            'default',
            { what: 'rulesetPersist', entries },
            colorize
        );
    };

    let revert = function() {
        let entries = diff();
        if ( entries.length === 0 ) { return; }
        vAPI.messaging.send(
            'default',
            { what: 'rulesetRevert', entries },
            colorize
        );
    };

    let start = function(ev) {
        let targetRow = ev.target.parentElement;
        let srcHn = targetRow.getAttribute('data-srchn') || '';
        let desHn = targetRow.getAttribute('data-deshn') || '';
        let type = targetRow.getAttribute('data-type') || '';
        if ( srcHn === '' || desHn === '' || type === '' ) { return; }
        let tabId = parseInt(targetRow.getAttribute('data-tabid'), 10);

        vAPI.messaging.send(
            'logger-ui.js',
            { what: 'getRuleEditorOptions' },
            options => { setup({ tabId, srcHn, desHn, type, options }); }
        );
    };

    let stop = function() {
        for ( let { node, type, handler, options } of listeners ) {
            node.removeEventListener(type, handler, options);
        }
        listeners = [];
        ruleEditorNode.querySelector('.buttonReload').removeEventListener('click', reload);
        removeSelf(ruleEditorNode);
    };

    return { start, stop };
})();

/******************************************************************************/

var toJunkyard = function(trs) {
    trs.remove();
    var i = trs.length;
    while ( i-- ) {
        trJunkyard.push(trs.nodeAt(i));
    }
};

/******************************************************************************/

var clearBuffer = function() {
    var tbody = document.querySelector('#content tbody');
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
    document.body.classList.toggle('compactView');
    uDom('#content table .vExpanded').removeClass('vExpanded');
};

var toggleCompactRow = function(ev) {
    ev.target.parentElement.classList.toggle('vExpanded');
};

/******************************************************************************/

var grabView = function() {
    if ( ownerId === undefined ) {
        ownerId = Date.now();
    }
    readLogBufferAsync();
};

var releaseView = function() {
    if ( ownerId === undefined ) { return; }
    vAPI.messaging.send(
        'logger-ui.js',
        { what: 'releaseView', ownerId: ownerId }
    );
    ownerId = undefined;
};

window.addEventListener('pagehide', releaseView);
window.addEventListener('pageshow', grabView);
// https://bugzilla.mozilla.org/show_bug.cgi?id=1398625
window.addEventListener('beforeunload', releaseView);

/******************************************************************************/

readLogBuffer();

uDom('#pageSelector').on('change', pageSelectorChanged);
uDom('#refresh').on('click', refreshTab);
uDom('#compactViewToggler').on('click', toggleCompactView);
uDom('#clean').on('click', cleanBuffer);
uDom('#clear').on('click', clearBuffer);
uDom('#maxEntries').on('change', onMaxEntriesChanged);
uDom('#content table').on('click', 'tr > td:nth-of-type(1)', toggleCompactRow);
uDom('#content table').on('click', 'tr[data-srchn][data-deshn][data-type] > td:nth-of-type(3)', ruleEditor.start);

/******************************************************************************/

})();
