/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
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

    Home: https://github.com/gorhill/uBlock
*/

/* global uDom */

'use strict';

/******************************************************************************/

(( ) => {

/******************************************************************************/

const messaging = vAPI.messaging;
const logger = self.logger = { ownerId: Date.now() };
const logDate = new Date();
const logDateTimezoneOffset = logDate.getTimezoneOffset() * 60000;
const loggerEntries = [];

let filteredLoggerEntries = [];
let filteredLoggerEntryVoidedCount = 0;

let popupLoggerBox;
let popupLoggerTooltips;
let activeTabId = 0;
let selectedTabId = 0;
let netInspectorPaused = false;
let cnameOfEnabled = false;

/******************************************************************************/

// Various helpers.

const tabIdFromPageSelector = logger.tabIdFromPageSelector = function() {
    const value = uDom.nodeFromId('pageSelector').value;
    return value !== '_' ? (parseInt(value, 10) || 0) : activeTabId;
};

/******************************************************************************/
/******************************************************************************/

// Current design allows for only one modal DOM-based dialog at any given time.
//
const modalDialog = (( ) => {
    const overlay = uDom.nodeFromId('modalOverlay');
    const container = overlay.querySelector(
        ':scope > div > div:nth-of-type(1)'
    );
    const closeButton = overlay.querySelector(
        ':scope > div > div:nth-of-type(2)'
    );
    let onDestroyed;

    const removeChildren = logger.removeAllChildren = function(node) {
        while ( node.firstChild ) {
            node.removeChild(node.firstChild);
        }
    };

    const create = function(selector, destroyListener) {
        const template = document.querySelector(selector);
        const dialog = template.cloneNode(true);
        removeChildren(container);
        container.appendChild(dialog);
        onDestroyed = destroyListener;
        return dialog;
    };

    const show = function() {
        overlay.classList.add('on');
    };

    const destroy = function() {
        overlay.classList.remove('on');
        const dialog = container.firstElementChild;
        removeChildren(container);
        if ( typeof onDestroyed === 'function' ) {
            onDestroyed(dialog);
        }
        onDestroyed = undefined;
    };

    const onClose = function(ev) {
        if ( ev.target === overlay || ev.target === closeButton ) {
            destroy();
        }
    };
    overlay.addEventListener('click', onClose);
    closeButton.addEventListener('click', onClose);

    return { create, show, destroy };
})();

self.logger.modalDialog = modalDialog;

/******************************************************************************/
/******************************************************************************/

const prettyRequestTypes = {
    'main_frame': 'doc',
    'stylesheet': 'css',
    'sub_frame': 'frame',
    'xmlhttprequest': 'fetch',
};

let allTabIds = new Map();
let allTabIdsToken;

/******************************************************************************/
/******************************************************************************/

// Emphasize hostname in URL, as this is what matters in uMatrix's rules.

const nodeFromURL = function(parent, url, re) {
    const fragment = document.createDocumentFragment();
    if ( re === undefined ) {
        fragment.textContent = url;
    } else {
        if ( typeof re === 'string' ) {
            re = new RegExp(re.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        }
        const matches = re.exec(url);
        if ( matches === null || matches[0].length === 0 ) {
            fragment.textContent = url;
        } else {
            if ( matches.index !== 0 ) {
                fragment.appendChild(
                    document.createTextNode(url.slice(0, matches.index))
                );
            }
            const b = document.createElement('b');
            b.textContent = url.slice(matches.index, re.lastIndex);
            fragment.appendChild(b);
            if ( re.lastIndex !== url.length ) {
                fragment.appendChild(
                    document.createTextNode(url.slice(re.lastIndex))
                );
            }
        }
    }
    if ( /^https?:\/\//.test(url) ) {
        const a = document.createElement('a');
        a.setAttribute('href', url);
        a.setAttribute('target', '_blank');
        fragment.appendChild(a);
    }
    parent.appendChild(fragment);
};

/******************************************************************************/

const padTo2 = function(v) {
    return v < 10 ? '0' + v : v;
};

const normalizeToStr = function(s) {
    return typeof s === 'string' && s !== '' ? s : '';
};

/******************************************************************************/

const LogEntry = function(details) {
    if ( details instanceof Object === false ) { return; }
    const receiver = LogEntry.prototype;
    for ( const prop in receiver ) {
        if (
            details.hasOwnProperty(prop) &&
            details[prop] !== receiver[prop]
        ) {
            this[prop] = details[prop];
        }
    }
    if ( details.aliasURL !== undefined ) {
        this.aliased = true;
    }
    if ( this.tabDomain === '' && this.tabHostname ) {
        this.tabDomain = this.tabHostname;
    }
    if ( this.domain === '' && this.hostname ) {
        this.domain = this.hostname;
    }
    if ( details.filter instanceof Object ) {
        this.isHeader = true;
    }
};

LogEntry.prototype = {
    aliased: false,
    dead: false,
    hostname: '',
    domain: '',
    id: '',
    isHeader: false,
    realm: '',
    tabHostname: '',
    tabDomain: '',
    tabId: undefined,
    textContent: '',
    tstamp: 0,
    type: '',
    voided: false,
};

/******************************************************************************/

const createLogSeparator = function(details, text) {
    const separator = new LogEntry();
    separator.tstamp = details.tstamp;
    separator.realm = 'message';
    separator.tabId = details.tabId;
    separator.type = 'tabLoad';
    separator.textContent = '';

    const textContent = [];
    logDate.setTime(separator.tstamp - logDateTimezoneOffset);
    textContent.push(
        // cell 0
        padTo2(logDate.getUTCHours()) + ':' +
            padTo2(logDate.getUTCMinutes()) + ':' +
            padTo2(logDate.getSeconds()),
        // cell 1
        text
    );
    separator.textContent = textContent.join('\t');

    if ( details.voided ) {
        separator.voided = true;
    }

    return separator;
};

/******************************************************************************/

// TODO: once refactoring is mature, consider using push() instead of
//       unshift(). This will require inverting the access logic
//       throughout the code.
//
const processLoggerEntries = function(response) {
    const entries = response.entries;
    if ( entries.length === 0 ) { return; }

    const autoDeleteVoidedRows = uDom.nodeFromId('pageSelector').value === '_';
    const previousCount = filteredLoggerEntries.length;

    for ( const entry of entries ) {
        const unboxed = JSON.parse(entry);
        if ( netInspectorPaused ) { continue; }
        const parsed = parseLogEntry(unboxed);
        if (
            parsed.tabId !== undefined &&
            allTabIds.has(parsed.tabId) === false
        ) {
            if ( autoDeleteVoidedRows ) { continue; }
            parsed.voided = true;
        }
        if ( parsed.type === 'doc' && parsed.aliased === false ) {
            const separator = createLogSeparator(parsed, unboxed.url);
            loggerEntries.unshift(separator);
            if ( rowFilterer.filterOne(separator) ) {
                filteredLoggerEntries.unshift(separator);
                if ( separator.voided ) {
                    filteredLoggerEntryVoidedCount += 1;
                }
            }
        }
        if ( cnameOfEnabled === false && parsed.aliased ) {
            uDom.nodeFromId('filterExprCnameOf').style.display = '';
            cnameOfEnabled = true;
        }
        loggerEntries.unshift(parsed);
        if ( rowFilterer.filterOne(parsed) ) {
            filteredLoggerEntries.unshift(parsed);
            if ( parsed.voided ) {
                filteredLoggerEntryVoidedCount += 1;
            }
        }
    }

    const addedCount = filteredLoggerEntries.length - previousCount;
    if ( addedCount !== 0 ) {
        viewPort.updateContent(addedCount);
        rowJanitor.inserted(addedCount);
    }
};

/******************************************************************************/

const parseLogEntry = function(details) {
    const entry = new LogEntry(details);

    // Assemble the text content, i.e. the pre-built string which will be
    // used to match logger output filtering expressions.
    const textContent = [];

    // Cell 0
    logDate.setTime(details.tstamp - logDateTimezoneOffset);
    textContent.push(
        padTo2(logDate.getUTCHours()) + ':' +
        padTo2(logDate.getUTCMinutes()) + ':' +
        padTo2(logDate.getSeconds())
    );

    // Cell 1
    if ( details.realm === 'message' ) {
        textContent.push(details.text);
        textContent.push('info');
        textContent.push('');
        entry.textContent = textContent.join('\t');
        return entry;
    }

    // Cell 1: source hostname
    textContent.push(normalizeToStr(entry.tabHostname));

    // Cell 2: partyness
    if (
        entry.realm === 'network' &&
        typeof entry.domain === 'string' &&
        entry.domain !== ''
    ) {
        let partyness = '';
        if ( entry.tabDomain !== undefined ) {
            partyness += entry.domain === entry.tabDomain ? '1' : '3';
        } else {
            partyness += '?';
        }
        textContent.push(partyness);
    } else {
        textContent.push('');
    }

    // Cell 3: url or filter details
    if ( entry.isHeader ) {
        textContent.push(details.filter.value);
    } else {
        textContent.push(normalizeToStr(details.url));
    }

    // Cell 4: type
    textContent.push(
        normalizeToStr(prettyRequestTypes[entry.type] || entry.type)
    );

    // Cell 5: status
    if ( entry.isHeader ) {
        if ( details.filter.change < 0 ) {
            textContent.push('--');
        } else if ( details.filter.change > 0 ) {
            textContent.push('++');
        } else {
            textContent.push('');
        }
    } else if ( details.filter ) {
        textContent.push('--');
    } else {
        textContent.push('');
    }

    // Hidden cells -- useful for row-filtering purpose

    // Cell 6
    if ( entry.aliased ) {
        textContent.push(`aliasURL=${details.aliasURL}`);
    }

    // Sentinel cell
    textContent.push('');

    entry.textContent = textContent.join('\t');
    return entry;
};

/******************************************************************************/

const viewPort = (( ) => {
    const vwRenderer = document.getElementById('vwRenderer');
    const vwScroller = document.getElementById('vwScroller');
    const vwVirtualContent = document.getElementById('vwVirtualContent');
    const vwContent = document.getElementById('vwContent');
    const vwLineSizer = document.getElementById('vwLineSizer');
    const vwLogEntryTemplate = document.querySelector('#logEntryTemplate > div');
    const vwEntries = [];

    let vwHeight = 0;
    let lineHeight = 0;
    let wholeHeight = 0;
    let lastTopPix = 0;
    let lastTopRow = 0;
    let scrollTimer;
    let resizeTimer;

    const ViewEntry = function() {
        this.div = document.createElement('div');
        this.div.className = 'logEntry';
        vwContent.appendChild(this.div);
        this.logEntry = undefined;
    };
    ViewEntry.prototype = {
        dispose: function() {
            vwContent.removeChild(this.div);
        },
    };

    const rowFromScrollTopPix = function(px) {
        return lineHeight !== 0 ? Math.floor(px / lineHeight) : 0;
    };

    // This is called when the browser fired scroll events
    const onScrollChanged = function() {
        const newScrollTopPix = vwScroller.scrollTop;
        const delta = newScrollTopPix - lastTopPix;
        if ( delta === 0 ) { return; }
        lastTopPix = newScrollTopPix;
        if ( filteredLoggerEntries.length <= 2 ) { return; }
        // No entries were rolled = all entries keep their current details
        if ( rollLines(rowFromScrollTopPix(newScrollTopPix)) ) {
            fillLines();
        }
        positionLines();
        vwContent.style.top = `${lastTopPix}px`;
    };

    // Coallesce scroll events
    const onScroll = function() {
        if ( scrollTimer !== undefined ) { return; }
        scrollTimer = setTimeout(
            ( ) => {
                scrollTimer = requestAnimationFrame(( ) => {
                    scrollTimer = undefined;
                    onScrollChanged();
                });
            },
            1000/32
        );
    };

    vwScroller.addEventListener('scroll', onScroll, { passive: true });

    const onLayoutChanged = function() {
        vwHeight = vwRenderer.clientHeight;
        vwContent.style.height = `${vwScroller.clientHeight}px`;

        const vExpanded =
            uDom.nodeFromSelector('#netInspector .vCompactToggler')
                .classList
                .contains('vExpanded');

        let newLineHeight =
            vwLineSizer.querySelector('.oneLine').clientHeight;
        if ( vExpanded ) {
            newLineHeight *= loggerSettings.linesPerEntry;
        }

        const lineCount = newLineHeight !== 0
            ? Math.ceil(vwHeight / newLineHeight) + 1
            : 0;
        if ( lineCount > vwEntries.length ) {
            do {
                vwEntries.push(new ViewEntry());
            } while ( lineCount > vwEntries.length );
        } else if ( lineCount < vwEntries.length ) {
            do {
                vwEntries.pop().dispose();
            } while ( lineCount < vwEntries.length );
        }

        const cellWidths = [];
        let reservedWidth = 0;
        for ( const elem of vwLineSizer.querySelectorAll('.oneLine span') ) {
            if ( elem.textContent.startsWith('%') ) {
                cellWidths.push(parseInt(elem.textContent.slice(1), 10) / 100);
                continue;
            }
            const width = elem.clientWidth + 1;
            reservedWidth += width;
            cellWidths.push(`${width}px`);
        }
        const cssRules = [
            '#vwContent .logEntry {',
            `  height: ${newLineHeight}px;`,
            '}',
        ];
        for ( let i = 0; i < cellWidths.length; i++ ) {
            const width = cellWidths[i];
            cssRules.push(
                `#vwContent .logEntry > div > span:nth-of-type(${i+1}) {`,
                '  width: ' + (
                    typeof width === 'string'
                        ? width
                        : `calc(calc(100% - ${reservedWidth}px) * ${width})`
                    ) + ';',
                '}',
            );
        }
        cssRules.push(
            '#vwContent .logEntry > div.messageRealm > span:nth-of-type(2) {',
            `  width: calc(100% - ${cellWidths[0]});`,
            '}',
            '',
        );
        document.getElementById('vwRendererRuntimeStyles').textContent =
            cssRules.join('\n');

        lineHeight = newLineHeight;
        positionLines();
        uDom.nodeFromId('netInspector')
            .classList
            .toggle('vExpanded', vExpanded);

        updateContent(0);
    };

    const updateLayout = function() {
        if ( resizeTimer !== undefined ) { return; }
        resizeTimer = setTimeout(
            ( ) => {
                resizeTimer = requestAnimationFrame(( ) => {
                    resizeTimer = undefined;
                    onLayoutChanged();
                });
            },
            1000/8
        );
    };

    window.addEventListener('resize', updateLayout, { passive: true });

    updateLayout();

    const renderToDiv = function(vwEntry, i) {
        if ( i >= filteredLoggerEntries.length ) {
            vwEntry.logEntry = undefined;
            return null;
        }

        const details = filteredLoggerEntries[i];
        if ( vwEntry.logEntry === details ) {
            return vwEntry.div.firstElementChild;
        }

        vwEntry.logEntry = details;

        const cells = details.textContent.split('\t');
        const div = vwLogEntryTemplate.cloneNode(true);
        const divcl = div.classList;
        let span;


        // Realm
        if ( details.realm !== undefined ) {
            divcl.add(details.realm + 'Realm');
        }

        // Timestamp
        span = div.children[0];
        span.textContent = cells[0];

        // Tab id
        if ( details.tabId !== undefined ) {
            div.setAttribute('data-tabid', details.tabId);
            if ( details.voided ) {
                divcl.add('voided');
            }
        }

        if ( details.realm === 'message' ) {
            if ( details.type !== undefined ) {
                div.setAttribute('data-type', details.type);
            }
            span = div.children[1];
            span.textContent = cells[1];
            return div;
        }

        if ( details.realm === 'network' ) {
            divcl.add('canDetails');
        }

        // Source hostname
        if ( details.tabHostname ) {
            div.setAttribute('data-srchn', details.tabHostname);
        }
        span = div.children[1];
        span.textContent = cells[1];

        // Partyness
        if (
            cells[2] !== '' &&
            details.realm === 'network' &&
            details.domain !== ''
        ) {
            div.setAttribute(
                'data-parties',
                `${details.tabDomain} \u21d2\n\u2003 (${cells[2]}) ${details.domain}`
            );
        }
        span = div.children[2];
        span.textContent = cells[2];

        // Destination hostname
        if ( details.hostname ) {
            div.setAttribute('data-deshn', details.hostname);
        }

        // URL or change details
        if ( details.isHeader ) {
            div.setAttribute('data-header', '1');
        }
        nodeFromURL(div.children[3], cells[3], details.hostname);

        // Type
        span = div.children[4];
        span.textContent = cells[4];

        // Event
        if ( cells[5] !== '' ) {
            div.setAttribute('data-status', cells[5]);
        }
        span = div.children[5];
        span.textContent = cells[5];

        // Alias URL (CNAME, etc.)
        if ( cells.length > 6 ) {
            const pos = details.textContent.lastIndexOf('\taliasURL=');
            if ( pos !== -1 ) {
                div.setAttribute('data-aliasid', details.id);
            }
        }

        return div;
    };

    // The idea is that positioning DOM elements is faster than
    // removing/inserting DOM elements.
    const positionLines = function() {
        if ( lineHeight === 0 ) { return; }
        let y = -(lastTopPix % lineHeight);
        for ( const vwEntry of vwEntries ) {
            vwEntry.div.style.top = `${y}px`;
            y += lineHeight;
        }
    };

    const rollLines = function(topRow) {
        let delta = topRow - lastTopRow;
        let deltaLength = Math.abs(delta);
        // No point rolling if no rows can be reused
        if ( deltaLength > 0 && deltaLength < vwEntries.length ) {
            if ( delta < 0 ) {      // Move bottom rows to the top
                vwEntries.unshift(...vwEntries.splice(delta));
            } else {                // Move top rows to the bottom
                vwEntries.push(...vwEntries.splice(0, delta));
            }
        }
        lastTopRow = topRow;
        return delta;
    };

    const fillLines = function() {
        let rowBeg = lastTopRow;
        for ( const vwEntry of vwEntries ) {
            const newDiv = renderToDiv(vwEntry, rowBeg);
            const container = vwEntry.div;
            const oldDiv = container.firstElementChild;
            if ( newDiv !== null ) {
                if ( oldDiv === null ) {
                    container.appendChild(newDiv);
                } else if ( newDiv !== oldDiv ) {
                    container.removeChild(oldDiv);
                    container.appendChild(newDiv);
                }
            } else if ( oldDiv !== null ) {
                container.removeChild(oldDiv);
            }
            rowBeg += 1;
        }
    };

    const contentChanged = function(addedCount) {
        lastTopRow += addedCount;
        const newWholeHeight = Math.max(
            filteredLoggerEntries.length * lineHeight,
            vwRenderer.clientHeight
        );
        if ( newWholeHeight !== wholeHeight ) {
            vwVirtualContent.style.height = `${newWholeHeight}px`;
            wholeHeight = newWholeHeight;
        }
    };

    const updateContent = function(addedCount) {
        contentChanged(addedCount);
        // Content changed
        if ( addedCount === 0 ) {
            if (
                lastTopRow !== 0 &&
                lastTopRow + vwEntries.length > filteredLoggerEntries.length
            ) {
                lastTopRow = filteredLoggerEntries.length - vwEntries.length;
                if ( lastTopRow < 0 ) { lastTopRow = 0; }
                lastTopPix = lastTopRow * lineHeight;
                vwContent.style.top = `${lastTopPix}px`;
                vwScroller.scrollTop = lastTopPix;
                positionLines();
            }
            fillLines();
            return;
        }

        // Content added
        // Preserve scroll position
        if ( lastTopPix === 0 ) {
            rollLines(0);
            positionLines();
            fillLines();
            return;
        }

        // Preserve row position
        lastTopPix += lineHeight * addedCount;
        vwContent.style.top = `${lastTopPix}px`;
        vwScroller.scrollTop = lastTopPix;
    };

    return { updateContent, updateLayout, };
})();

/******************************************************************************/

const updateCurrentTabTitle = (( ) => {
    const i18nCurrentTab = vAPI.i18n('loggerCurrentTab');

    return function() {
        const select = uDom.nodeFromId('pageSelector');
        if ( select.value !== '_' || activeTabId === 0 ) { return; }
        const opt0 = select.querySelector('[value="_"]');
        const opt1 = select.querySelector(`[value="${activeTabId}"]`);
        let text = i18nCurrentTab;
        if ( opt1 !== null ) {
            text += ' / ' + opt1.textContent;
        }
        opt0.textContent = text;
    };
})();

/******************************************************************************/

const synchronizeTabIds = function(newTabIds) {
    const select = uDom.nodeFromId('pageSelector');
    const selectedTabValue = select.value;
    const oldTabIds = allTabIds;

    // Collate removed tab ids.
    const toVoid = new Set();
    for ( const tabId of oldTabIds.keys() ) {
        if ( newTabIds.has(tabId) ) { continue; }
        toVoid.add(tabId);
    }
    allTabIds = newTabIds;

    // Mark as "void" all logger entries which are linked to now invalid
    // tab ids.
    // When an entry is voided without being removed, we re-create a new entry
    // in order to ensure the entry has a new identity. A new identify ensures
    // that identity-based associations elsewhere are automatically
    // invalidated.
    if ( toVoid.size !== 0 ) {
        const autoDeleteVoidedRows = selectedTabValue === '_';
        let rowVoided = false;
        for ( let i = 0, n = loggerEntries.length; i < n; i++ ) {
            const entry = loggerEntries[i];
            if ( toVoid.has(entry.tabId) === false ) { continue; }
            if ( entry.voided ) { continue; }
            rowVoided = entry.voided = true;
            if ( autoDeleteVoidedRows ) {
                entry.dead = true;
            }
            loggerEntries[i] = new LogEntry(entry);
        }
        if ( rowVoided ) {
            rowFilterer.filterAll();
        }
    }

    // Remove popup if it is currently bound to a removed tab.
    if ( toVoid.has(popupManager.tabId) ) {
        popupManager.toggleOff();
    }

    const tabIds = Array.from(newTabIds.keys()).sort(function(a, b) {
        return newTabIds.get(a).localeCompare(newTabIds.get(b));
    });
    let j = 3;
    for ( let i = 0; i < tabIds.length; i++ ) {
        const tabId = tabIds[i];
        if ( tabId <= 0 ) { continue; }
        if ( j === select.options.length ) {
            select.appendChild(document.createElement('option'));
        }
        const option = select.options[j];
        // Truncate too long labels.
        option.textContent = newTabIds.get(tabId).slice(0, 80);
        option.setAttribute('value', tabId);
        if ( option.value === selectedTabValue ) {
            select.selectedIndex = j;
            option.setAttribute('selected', '');
        } else {
            option.removeAttribute('selected');
        }
        j += 1;
    }
    while ( j < select.options.length ) {
        select.removeChild(select.options[j]);
    }
    if ( select.value !== selectedTabValue ) {
        select.selectedIndex = 0;
        select.value = '';
        select.options[0].setAttribute('selected', '');
        pageSelectorChanged();
    }

    updateCurrentTabTitle();
};

/******************************************************************************/

const onLogBufferRead = function(response) {
    if ( !response || response.unavailable ) { return; }

    // Disable tooltips?
    if (
        popupLoggerTooltips === undefined &&
        response.tooltips !== undefined
    ) {
        popupLoggerTooltips = response.tooltips;
        if ( popupLoggerTooltips === false ) {
            uDom('[data-i18n-title]').attr('title', '');
        }
    }

    // Tab id of currently active tab
    let activeTabIdChanged = false;
    if ( response.activeTabId ) {
        activeTabIdChanged = response.activeTabId !== activeTabId;
        activeTabId = response.activeTabId;
    }

    if ( Array.isArray(response.pageStores) ) {
        response.pageStores = new Map(response.pageStores);
    }

    // List of tab ids has changed
    if ( response.pageStores !== undefined ) {
        synchronizeTabIds(response.pageStores);
        allTabIdsToken = response.pageStoresToken;
    }

    if ( activeTabIdChanged ) {
        pageSelectorFromURLHash();
    }

    processLoggerEntries(response);

    // Synchronize DOM with sent logger data
    document.body.classList.toggle(
        'colorBlind',
        response.colorBlind === true
    );
    uDom.nodeFromId('clean').classList.toggle(
        'disabled',
        filteredLoggerEntryVoidedCount === 0
    );
    uDom.nodeFromId('clear').classList.toggle(
        'disabled',
        filteredLoggerEntries.length === 0
    );
};

/******************************************************************************/

const readLogBuffer = (( ) => {
    let timer;

    const readLogBufferNow = async function() {
        if ( logger.ownerId === undefined ) { return; }

        const msg = {
            what: 'readAll',
            ownerId: logger.ownerId,
            pageStoresToken: allTabIdsToken,
        };

        // This is to detect changes in the position or size of the logger
        // popup window (if in use).
        if (
            popupLoggerBox instanceof Object &&
            (
                self.screenX !== popupLoggerBox.x ||
                self.screenY !== popupLoggerBox.y ||
                self.outerWidth !== popupLoggerBox.w ||
                self.outerHeight !== popupLoggerBox.h
            )
        ) {
            popupLoggerBox.x = self.screenX;
            popupLoggerBox.y = self.screenY;
            popupLoggerBox.w = self.outerWidth;
            popupLoggerBox.h = self.outerHeight;
            msg.popupLoggerBoxChanged = true;
        }

        const response = await vAPI.messaging.send('loggerUI', msg);

        timer = undefined;
        onLogBufferRead(response);
        readLogBufferLater();
    };

    const readLogBufferLater = function() {
        if ( timer !== undefined ) { return; }
        if ( logger.ownerId === undefined ) { return; }
        timer = vAPI.setTimeout(readLogBufferNow, 1200);
    };

    readLogBufferNow();

    return readLogBufferLater;
})();
 
/******************************************************************************/

const pageSelectorChanged = function() {
    const select = uDom.nodeFromId('pageSelector');
    window.location.replace('#' + select.value);
    pageSelectorFromURLHash();
};

const pageSelectorFromURLHash = (( ) => {
    let lastHash;
    let lastSelectedTabId;

    return function() {
        let hash = window.location.hash.slice(1);
        let match = /^([^+]+)\+(.+)$/.exec(hash);
        if ( match !== null ) {
            hash = match[1];
            activeTabId = parseInt(match[2], 10) || 0;
            window.location.hash = '#' + hash;
        }

        if ( hash !== lastHash ) {
            const select = uDom.nodeFromId('pageSelector');
            let option = select.querySelector(
                'option[value="' + hash + '"]'
            );
            if ( option === null ) {
                hash = '0';
                option = select.options[0];
            }
            select.selectedIndex = option.index;
            select.value = option.value;
            lastHash = hash;
        }

        selectedTabId = hash === '_'
            ? activeTabId
            : parseInt(hash, 10) || 0;

        if ( lastSelectedTabId === selectedTabId ) { return; }

        rowFilterer.filterAll();
        document.dispatchEvent(new Event('tabIdChanged'));
        updateCurrentTabTitle();
        uDom('.needtab').toggleClass('disabled', selectedTabId <= 0);
        lastSelectedTabId = selectedTabId;
    };
})();

/******************************************************************************/

const reloadTab = function(ev) {
    const tabId = tabIdFromPageSelector();
    if ( tabId <= 0 ) { return; }
    messaging.send('loggerUI', {
        what: 'forceReloadTab',
        tabId: tabId,
        bypassCache: ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey),
    });
};

/******************************************************************************/
/******************************************************************************/

// Per-logger entry dialog

(( ) => {
    let dialog = null;
    let targetRow = null;
    let targetTabId;

    const onClick = async function(ev) {
        const target = ev.target;
        const tcl = target.classList;

        // Select a mode
        if ( tcl.contains('header') ) {
            ev.stopPropagation();
            dialog.setAttribute('data-pane', target.getAttribute('data-pane') );
            return;
        }
    };

    const tabIdFromAttribute = function(elem) {
        const value = elem.getAttribute('data-tabid') || '';
        const tabId = parseInt(value, 10);
        return isNaN(tabId) ? 0 : tabId;
    };

    const aliasURLFromID = function(id) {
        if ( id === '' ) { return ''; }
        for ( const entry of loggerEntries ) {
            if ( entry.id !== id || entry.aliased ) { continue; }
            const fields = entry.textContent.split('\t');
            return fields[3] || '';
        }
        return '';
    };

    const fillSummaryPane = function() {
        const rows = dialog.querySelectorAll('.pane[data-pane="details"] > div');
        const tr = targetRow;
        const trch = tr.children;
        let text;
        // Root and immediate contexts
        const srchn = tr.getAttribute('data-srchn') || '';
        if ( srchn !== '' ) {
            rows[0].children[1].textContent = srchn;
        } else {
            rows[0].style.display = 'none';
        }
        // Partyness
        text = tr.getAttribute('data-parties') || '';
        if ( text !== '' ) {
            rows[1].children[1].textContent = text;
        } else {
            rows[1].style.display = 'none';
        }
        // Type
        text = trch[4].textContent;
        if ( text !== '' ) {
            rows[2].children[1].textContent = text;
        } else {
            rows[2].style.display = 'none';
        }
        // URL
        const canonicalURL = trch[3].textContent;
        if ( canonicalURL !== '' ) {
            const attr = tr.getAttribute('data-status') || '';
            if ( attr !== '' ) {
                rows[3].setAttribute('data-status', attr);
            }
            rows[3].children[1].appendChild(trch[3].cloneNode(true));
        } else {
            rows[3].style.display = 'none';
        }
        // Alias URL
        text = tr.getAttribute('data-aliasid');
        const aliasURL = text ? aliasURLFromID(text) : '';
        if ( aliasURL !== '' ) {
            rows[4].children[1].textContent =
                vAPI.hostnameFromURI(aliasURL) + ' \u21d2\n\u2003 ' +
                vAPI.hostnameFromURI(canonicalURL);
            rows[5].children[1].textContent = aliasURL;
        } else {
            rows[4].style.display = 'none';
            rows[5].style.display = 'none';
        }
    };

    const fillRulePane = function() {
        const frame = dialog.querySelector('.panes [data-pane="rule"] iframe');
        const srchn = targetRow.getAttribute('data-srchn') || '';
        const deshn = targetRow.getAttribute('data-deshn') || '';
        const type = targetRow.children[4].textContent.trim() || '';
        frame.src = 'popup.html?rule=' + encodeURIComponent(
            `${srchn} ${deshn} ${type}`
        );
    };

    const fillDialog = function() {
        dialog = modalDialog.create(
            '#netFilteringDialog',
            ( ) => {
                targetRow = null;
                dialog = null;
            }
        );
        fillSummaryPane();
        fillRulePane();
        dialog.addEventListener('click', ev => { onClick(ev); }, true);
        modalDialog.show();
    };

    const toggleOn = async function(ev) {
        targetRow = ev.target.closest('.canDetails');
        if ( targetRow === null ) { return; }
        ev.stopPropagation();
        targetTabId = tabIdFromAttribute(targetRow);
        fillDialog();
    };

    uDom('#netInspector').on(
        'click',
        '.canDetails > span:nth-of-type(1),.canDetails > span:nth-of-type(3),.canDetails > span:nth-of-type(6)',
        ev => { toggleOn(ev); }
    );
})();

/******************************************************************************/
/******************************************************************************/

const rowFilterer = (( ) => {
    const userFilters = [];
    const builtinFilters = [];

    let masterFilterSwitch = true;
    let filters = [];

    const parseInput = function() {
        userFilters.length = 0;

        const rawParts =
            uDom.nodeFromSelector('#filterInput > input')
                .value
                .trim()
                .split(/\s+/);
        const n = rawParts.length;
        const reStrs = [];
        let not = false;
        for ( let i = 0; i < n; i++ ) {
            let rawPart = rawParts[i];
            if ( rawPart.charAt(0) === '!' ) {
                if ( reStrs.length === 0 ) {
                    not = true;
                }
                rawPart = rawPart.slice(1);
            }
            let reStr = '';
            if ( rawPart.startsWith('/') && rawPart.endsWith('/') ) {
                reStr = rawPart.slice(1, -1);
                try {
                    new RegExp(reStr);
                } catch(ex) {
                    reStr = '';
                }
            }
            if ( reStr === '' ) {
                const hardBeg = rawPart.startsWith('|');
                if ( hardBeg ) {
                    rawPart = rawPart.slice(1);
                }
                const hardEnd = rawPart.endsWith('|');
                if ( hardEnd ) {
                    rawPart = rawPart.slice(0, -1);
                }
                // https://developer.mozilla.org/en/docs/Web/JavaScript/Guide/Regular_Expressions
                reStr = rawPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // https://github.com/orgs/uBlockOrigin/teams/ublock-issues-volunteers/discussions/51
                //   Be more flexible when interpreting leading/trailing pipes,
                //   as leading/trailing pipes are often used in static filters.
                if ( hardBeg ) {
                    reStr = reStr !== '' ? '(?:^|\\s|\\|)' + reStr : '\\|';
                }
                if ( hardEnd ) {
                    reStr += '(?:\\||\\s|$)';
                }
            }
            if ( reStr === '' ) { continue; }
            reStrs.push(reStr);
            if ( i < (n - 1) && rawParts[i + 1] === '||' ) {
                i += 1;
                continue;
            }
            reStr = reStrs.length === 1 ? reStrs[0] : reStrs.join('|');
            userFilters.push({
                re: new RegExp(reStr, 'i'),
                r: !not
            });
            reStrs.length = 0;
            not = false;
        }
        filters = builtinFilters.concat(userFilters);
    };

    const filterOne = function(logEntry) {
        if (
            logEntry.dead ||
            selectedTabId !== 0 &&
            (
                typeof logEntry.tabId === 'number' &&
                logEntry.tabId > 0 &&
                logEntry.tabId !== selectedTabId
            )
        ) {
            return false;
        }

        if ( masterFilterSwitch === false || filters.length === 0 ) {
            return true;
        }

        // Do not filter out tab load event, they help separate key sections
        // of logger.
        if ( logEntry.type === 'tabLoad' ) { return true; }

        for ( const f of filters ) {
            if ( f.re.test(logEntry.textContent) !== f.r ) { return false; }
        }
        return true;
    };

    const filterAll = function() {
        filteredLoggerEntries = [];
        filteredLoggerEntryVoidedCount = 0;
        for ( const entry of loggerEntries ) {
            if ( filterOne(entry) === false ) { continue; }
            filteredLoggerEntries.push(entry);
            if ( entry.voided ) {
                filteredLoggerEntryVoidedCount += 1;
            }
        }
        viewPort.updateContent(0);
        uDom.nodeFromId('filterButton').classList.toggle(
            'active',
            filters.length !== 0
        );
        uDom.nodeFromId('clean').classList.toggle(
            'disabled',
            filteredLoggerEntryVoidedCount === 0
        );
        uDom.nodeFromId('clear').classList.toggle(
            'disabled',
            filteredLoggerEntries.length === 0
        );
    };

    const onFilterChangedAsync = (( ) => {
        let timer;
        const commit = ( ) => {
            timer = undefined;
            parseInput();
            filterAll();
        };
        return ( ) => {
            if ( timer !== undefined ) {
                clearTimeout(timer);
            }
            timer = vAPI.setTimeout(commit, 750);
        };
    })();

    const onFilterButton = function() {
        masterFilterSwitch = !masterFilterSwitch;
        uDom.nodeFromId('netInspector').classList.toggle(
            'f',
            masterFilterSwitch
        );
        filterAll();            
    };

    const onToggleExtras = function(ev) {
        ev.target.classList.toggle('expanded');
    };

    const onToggleBuiltinExpression = function(ev) {
        builtinFilters.length = 0;

        ev.target.classList.toggle('on');
        const filtexElems = ev.currentTarget.querySelectorAll('[data-filtex]');
        const orExprs = [];
        let not = false;
        for ( const filtexElem of filtexElems ) {
            const filtex = filtexElem.getAttribute('data-filtex');
            const active = filtexElem.classList.contains('on');
            if ( filtex === '!' ) {
                if ( orExprs.length !== 0 ) {
                    builtinFilters.push({
                        re: new RegExp(orExprs.join('|'), 'i'),
                        r: !not
                    });
                    orExprs.length = 0;
                }
                not = active;
            } else if ( active ) {
                orExprs.push(filtex);
            }
        }
        if ( orExprs.length !== 0 ) {
            builtinFilters.push({
                re: new RegExp(orExprs.join('|'), 'i'),
                r: !not
            });
        }
        filters = builtinFilters.concat(userFilters);
        uDom.nodeFromId('filterExprButton').classList.toggle(
            'active',
            builtinFilters.length !== 0
        );
        filterAll();
    };

    uDom('#filterButton').on('click', onFilterButton);
    uDom('#filterInput > input').on('input', onFilterChangedAsync);
    uDom('#filterExprButton').on('click', onToggleExtras);
    uDom('#filterExprPicker').on('click', '[data-filtex]', onToggleBuiltinExpression);

    // https://github.com/gorhill/uBlock/issues/404
    //   Ensure page state is in sync with the state of its various widgets.
    parseInput();
    filterAll();

    return { filterOne, filterAll };
})();

/******************************************************************************/

// Discard logger entries to prevent undue memory usage growth. The criteria
// to discard are multiple and user configurable:
//
// - Max number of page load per distinct tab
// - Max number of entry per distinct tab
// - Max entry age

const rowJanitor = (( ) => {
    const tabIdToDiscard = new Set();
    const tabIdToLoadCountMap = new Map();
    const tabIdToEntryCountMap = new Map();

    let rowIndex = 0;

    const discard = function(timeRemaining) {
        const opts = loggerSettings.discard;
        const maxLoadCount = typeof opts.maxLoadCount === 'number'
            ? opts.maxLoadCount
            : 0;
        const maxEntryCount = typeof opts.maxEntryCount === 'number'
            ? opts.maxEntryCount
            : 0;
        const obsolete = typeof opts.maxAge === 'number'
            ? Date.now() - opts.maxAge * 60000
            : 0;
        const deadline = Date.now() + Math.ceil(timeRemaining);

        let i = rowIndex;
        // TODO: below should not happen -- remove when confirmed.
        if ( i >= loggerEntries.length ) {
            i = 0;
        }

        if ( i === 0 ) {
            tabIdToDiscard.clear();
            tabIdToLoadCountMap.clear();
            tabIdToEntryCountMap.clear();
        }

        let idel = -1;
        let bufferedTabId = 0;
        let bufferedEntryCount = 0;
        let modified = false;

        while ( i < loggerEntries.length ) {

            if ( i % 64 === 0 && Date.now() >= deadline ) { break; }

            const entry = loggerEntries[i];
            const tabId = entry.tabId || 0;

            if ( entry.dead || tabIdToDiscard.has(tabId) ) {
                if ( idel === -1 ) { idel = i; }
                i += 1;
                continue;
            }

            if ( maxLoadCount !== 0 && entry.type === 'tabLoad' ) {
                let count = (tabIdToLoadCountMap.get(tabId) || 0) + 1;
                tabIdToLoadCountMap.set(tabId, count);
                if ( count >= maxLoadCount ) {
                    tabIdToDiscard.add(tabId);
                }
            }

            if ( maxEntryCount !== 0 ) {
                if ( bufferedTabId !== tabId ) {
                    if ( bufferedEntryCount !== 0 ) {
                        tabIdToEntryCountMap.set(bufferedTabId, bufferedEntryCount);
                    }
                    bufferedTabId = tabId;
                    bufferedEntryCount = tabIdToEntryCountMap.get(tabId) || 0;
                }
                bufferedEntryCount += 1;
                if ( bufferedEntryCount >= maxEntryCount ) {
                    tabIdToDiscard.add(bufferedTabId);
                }
            }

            // Since entries in the logger are chronologically ordered,
            // everything below obsolete is to be discarded.
            if ( obsolete !== 0 && entry.tstamp <= obsolete ) {
                if ( idel === -1 ) { idel = i; }
                break;
            }

            if ( idel !== -1 ) {
                loggerEntries.copyWithin(idel, i);
                loggerEntries.length -= i - idel;
                idel = -1;
                modified = true;
            }

            i += 1;
        }

        if ( idel !== -1 ) {
            loggerEntries.length = idel;
            modified = true;
        }

        if ( i >= loggerEntries.length ) { i = 0; }
        rowIndex = i;

        if ( rowIndex === 0 ) {
            tabIdToDiscard.clear();
            tabIdToLoadCountMap.clear();
            tabIdToEntryCountMap.clear();
        }

        if ( modified === false ) { return; }

        rowFilterer.filterAll();
    };

    const discardAsync = function() {
        setTimeout(
            ( ) => {
                self.requestIdleCallback(deadline => {
                    discard(deadline.timeRemaining());
                    discardAsync();
                });
            },
            1889
        );
    };

    // Clear voided entries from the logger's visible content.
    //
    // Voided entries should be visible only from the "All" option of the
    // tab selector.
    //
    const clean = function() {
        if ( filteredLoggerEntries.length === 0 ) { return; }

        let j = 0;
        let targetEntry = filteredLoggerEntries[0];
        for ( const entry of loggerEntries ) {
            if ( entry !== targetEntry ) { continue; }
            if ( entry.voided ) {
                entry.dead = true;
            }
            j += 1;
            if ( j === filteredLoggerEntries.length ) { break; }
            targetEntry = filteredLoggerEntries[j];
        }
        rowFilterer.filterAll();
    };

    // Clear the logger's visible content.
    //
    // "Unrelated" entries -- shown for convenience -- will be also cleared
    // if and only if the filtered logger content is made entirely of unrelated
    // entries. In effect, this means clicking a second time on the eraser will
    // cause unrelated entries to also be cleared.
    //
    const clear = function() {
        if ( filteredLoggerEntries.length === 0 ) { return; }

        let clearUnrelated = true;
        if ( selectedTabId !== 0 ) {
            for ( const entry of filteredLoggerEntries ) {
                if ( entry.tabId === selectedTabId ) {
                    clearUnrelated = false;
                    break;
                }
            }
        }

        let j = 0;
        let targetEntry = filteredLoggerEntries[0];
        for ( const entry of loggerEntries ) {
            if ( entry !== targetEntry ) { continue; }
            if ( entry.tabId === selectedTabId || clearUnrelated ) {
                entry.dead = true;
            }
            j += 1;
            if ( j === filteredLoggerEntries.length ) { break; }
            targetEntry = filteredLoggerEntries[j];
        }
        rowFilterer.filterAll();
    };

    discardAsync();

    uDom.nodeFromId('clean').addEventListener('click', clean);
    uDom.nodeFromId('clear').addEventListener('click', clear);

    return {
        inserted: function(count) {
            if ( rowIndex !== 0 ) {
                rowIndex += count;
            }
        },
    };
})();

/******************************************************************************/

const pauseNetInspector = function() {
    netInspectorPaused = uDom.nodeFromId('netInspector')
                             .classList
                             .toggle('paused');
};

/******************************************************************************/

const toggleVCompactView = function() {
    uDom.nodeFromSelector('#netInspector .vCompactToggler')
        .classList
        .toggle('vExpanded');
    viewPort.updateLayout();
};

/******************************************************************************/

const popupManager = (( ) => {
    let realTabId = 0;
    let popup = null;
    let popupObserver = null;

    const resizePopup = function() {
        if ( popup === null ) { return; }
        const popupBody = popup.contentWindow.document.body;
        if ( popupBody.clientWidth !== 0 && popup.clientWidth !== popupBody.clientWidth ) {
            popup.style.setProperty('width', popupBody.clientWidth + 'px');
        }
        if ( popupBody.clientHeight !== 0 && popup.clientHeight !== popupBody.clientHeight ) {
            popup.style.setProperty('height', popupBody.clientHeight + 'px');
        }
    };

    const onLoad = function() {
        resizePopup();
        popupObserver.observe(popup.contentDocument.body, {
            subtree: true,
            attributes: true
        });
    };

    const setTabId = function(tabId) {
        if ( popup === null ) { return; }
        popup.setAttribute('src', 'popup.html?tabid=' + tabId);
    };

    const onTabIdChanged = function() {
        const tabId = tabIdFromPageSelector();
        if ( tabId <= 0 ) { return toggleOff(); }
        realTabId = tabId;
        setTabId(realTabId);
    };

    const toggleOn = function() {
        const tabId = tabIdFromPageSelector();
        if ( tabId === 0 ) { return; }
        realTabId = tabId;
        popup = uDom.nodeFromId('popupContainer');
        popup.addEventListener('load', onLoad);
        popupObserver = new MutationObserver(resizePopup);
        const parent = uDom.nodeFromId('inspectors');
        const rect = parent.getBoundingClientRect();
        popup.style.setProperty('right', `${rect.right - parent.clientWidth}px`);
        parent.classList.add('popupOn');
        document.addEventListener('tabIdChanged', onTabIdChanged);
        setTabId(realTabId);
        uDom.nodeFromId('showpopup').classList.add('active');
    };

    const toggleOff = function() {
        uDom.nodeFromId('showpopup').classList.remove('active');
        document.removeEventListener('tabIdChanged', onTabIdChanged);
        uDom.nodeFromId('inspectors').classList.remove('popupOn');
        popup.removeEventListener('load', onLoad);
        popupObserver.disconnect();
        popupObserver = null;
        popup.setAttribute('src', '');
    
        realTabId = 0;
    };

    const api = {
        get tabId() { return realTabId || 0; },
        toggleOff: function() {
            if ( realTabId !== 0 ) {
                toggleOff();
            }
        }
    };

    uDom.nodeFromId('showpopup').addEventListener(
        'click',
        ( ) => {
            void (realTabId === 0 ? toggleOn() : toggleOff());
        }
    );

    return api;
})();

/******************************************************************************/

(( ) => {
    const lines = [];
    const options = {
        format: 'list',
        encoding: 'markdown',
        time: 'anonymous',
    };
    let dialog;

    const collectLines = function() {
        lines.length = 0;
        let t0 = filteredLoggerEntries.length !== 0
            ? filteredLoggerEntries[filteredLoggerEntries.length - 1].tstamp
            : 0;
        for ( const entry of filteredLoggerEntries ) {
            const text = entry.textContent;
            const fields = [];
            let i = 0;
            let beg = text.indexOf('\t');
            if ( beg === 0 ) { continue; }
            let timeField = text.slice(0, beg);
            if ( options.time === 'anonymous' ) {
                timeField = '+' + Math.round((entry.tstamp - t0) / 1000).toString();
            }
            fields.push(timeField);
            beg += 1;
            while ( beg < text.length ) {
                let end = text.indexOf('\t', beg);
                if ( end === -1 ) { end = text.length; }
                fields.push(text.slice(beg, end));
                beg = end + 1;
                i += 1;
            }
            lines.push(fields);
        }
    };

    const formatAsPlainTextTable = function() {
        const outputAll = [];
        for ( const fields of lines ) {
            outputAll.push(fields.join('\t'));
        }
        outputAll.push('');
        return outputAll.join('\n');
    };

    const formatAsMarkdownTable = function() {
        const outputAll = [];
        let fieldCount = 0;
        for ( const fields of lines ) {
            if ( fields.length <= 2 ) { continue; }
            if ( fields.length > fieldCount ) {
                fieldCount = fields.length;
            }
            const outputOne = [];
            for ( let i = 0; i < fields.length; i++ ) {
                const field = fields[i];
                let code = /\b(?:www\.|https?:\/\/)/.test(field) ? '`' : '';
                outputOne.push(` ${code}${field.replace(/\|/g, '\\|')}${code} `);
            }
            outputAll.push(outputOne.join('|'));
        }
        if ( fieldCount !== 0 ) {
            outputAll.unshift(
                `${' |'.repeat(fieldCount-1)} `,
                `${':--- |'.repeat(fieldCount-1)}:--- `
            );
        }
        return `<details><summary>Logger output</summary>\n\n|${outputAll.join('|\n|')}|\n</details>\n`;
    };

    const formatAsTable = function() {
        if ( options.encoding === 'plain' ) {
            return formatAsPlainTextTable();
        }
        return formatAsMarkdownTable();
    };

    const formatAsList = function() {
        const outputAll = [];
        for ( const fields of lines ) {
            const outputOne = [];
            for ( let i = 0; i < fields.length; i++ ) {
                let str = fields[i];
                if ( str.length === 0 ) { continue; }
                outputOne.push(str);
            }
            outputAll.push(outputOne.join('\n'));
        }
        let before, between, after;
        if ( options.encoding === 'markdown' ) {
            const code = '```';
            before = `<details><summary>Logger output</summary>\n\n${code}\n`;
            between = `\n${code}\n${code}\n`;
            after = `\n${code}\n</details>\n`;
        } else {
            before = '';
            between = '\n\n';
            after = '\n';
        }
        return `${before}${outputAll.join(between)}${after}`;
    };

    const format = function() {
        const output = dialog.querySelector('.output');
        if ( options.format === 'list' ) {
            output.textContent = formatAsList();
        } else {
            output.textContent = formatAsTable();
        }
    };

    const setRadioButton = function(group, value) {
        if ( options.hasOwnProperty(group) === false ) { return; }
        const groupEl = dialog.querySelector(`[data-radio="${group}"]`);
        const buttonEls = groupEl.querySelectorAll('[data-radio-item]');
        for ( const buttonEl of buttonEls ) {
            buttonEl.classList.toggle(
                'on',
                buttonEl.getAttribute('data-radio-item') === value
            );
        }
        options[group] = value;
    };

    const onOption = function(ev) {
        const target = ev.target.closest('span[data-i18n]');
        if ( target === null ) { return; }

        // Copy to clipboard
        if ( target.matches('.pushbutton') ) {
            const textarea = dialog.querySelector('textarea');
            textarea.focus();
            if ( textarea.selectionEnd === textarea.selectionStart ) {
                textarea.select();
            }
            document.execCommand('copy');
            ev.stopPropagation();
            return;
        }

        // Radio buttons
        const group = target.closest('[data-radio]');
        if ( group === null ) { return; }
        if ( target.matches('span.on') ) { return; }
        const item = target.closest('[data-radio-item]');
        if ( item === null ) { return; }
        setRadioButton(
            group.getAttribute('data-radio'),
            item.getAttribute('data-radio-item')
        );
        format();
        ev.stopPropagation();
    };

    const toggleOn = function() {
        dialog = modalDialog.create(
            '#loggerExportDialog',
            ( ) => {
                dialog = undefined;
                lines.length = 0;
            }
        );

        setRadioButton('format', options.format);
        setRadioButton('encoding', options.encoding);

        collectLines();
        format();

        dialog.querySelector('.options').addEventListener(
            'click',
            onOption,
            { capture: true }
        );

        modalDialog.show();
    };

    uDom.nodeFromId('loggerExport').addEventListener('click', toggleOn);
})();

/******************************************************************************/

// TODO:
// - Give some thoughts to:
//   - an option to discard immediately filtered out new entries
//   - max entry count _per load_
//
const loggerSettings = (( ) => {
    const settings = {
        discard: {
            maxAge: 240,            // global
            maxEntryCount: 2000,    // per-tab
            maxLoadCount: 20,       // per-tab
        },
        linesPerEntry: 4,
    };

    {
        try {
            const stored = JSON.parse(vAPI.localStorage.getItem('loggerSettings'));
            if ( typeof stored.discard.maxAge === 'number' ) {
                settings.discard.maxAge = stored.discard.maxAge;
            }
            if ( typeof stored.discard.maxEntryCount === 'number' ) {
                settings.discard.maxEntryCount = stored.discard.maxEntryCount;
            }
            if ( typeof stored.discard.maxLoadCount === 'number' ) {
                settings.discard.maxLoadCount = stored.discard.maxLoadCount;
            }
            if ( typeof stored.linesPerEntry === 'number' ) {
                settings.linesPerEntry = stored.linesPerEntry;
            }
        } catch(ex) {
        }
    }

    const valueFromInput = function(input, def) {
        let value = parseInt(input.value, 10);
        if ( isNaN(value) ) { value = def; }
        const min = parseInt(input.getAttribute('min'), 10);
        if ( isNaN(min) === false ) {
            value = Math.max(value, min);
        }
        const max = parseInt(input.getAttribute('max'), 10);
        if ( isNaN(max) === false ) {
            value = Math.min(value, max);
        }
        return value;
    };

    const toggleOn = function() {
        const dialog = modalDialog.create(
            '#loggerSettingsDialog',
            dialog => {
                toggleOff(dialog);
            }
        );

        // Number inputs
        let inputs = dialog.querySelectorAll('input[type="number"]');
        inputs[0].value = settings.discard.maxAge;
        inputs[1].value = settings.discard.maxLoadCount;
        inputs[2].value = settings.discard.maxEntryCount;
        inputs[3].value = settings.linesPerEntry;
        inputs[3].addEventListener('input', ev => {
            settings.linesPerEntry = valueFromInput(ev.target, 4);
            viewPort.updateLayout();
        });

        modalDialog.show();
    };

    const toggleOff = function(dialog) {
        // Number inputs
        let inputs = dialog.querySelectorAll('input[type="number"]');
        settings.discard.maxAge = valueFromInput(inputs[0], 240);
        settings.discard.maxLoadCount = valueFromInput(inputs[1], 25);
        settings.discard.maxEntryCount = valueFromInput(inputs[2], 2000);
        settings.linesPerEntry = valueFromInput(inputs[3], 4);

        vAPI.localStorage.setItem(
            'loggerSettings',
            JSON.stringify(settings)
        );

        viewPort.updateLayout();
    };

    uDom.nodeFromId('loggerSettings').addEventListener('click', toggleOn);

    return settings;
})();

/******************************************************************************/

logger.resize = (function() {
    let timer;

    const resize = function() {
        const vrect = document.body.getBoundingClientRect();
        const elems = document.querySelectorAll('.vscrollable');
        for ( const elem of elems ) {
            const crect = elem.getBoundingClientRect();
            const dh = crect.bottom - vrect.bottom;
            if ( dh === 0 ) { continue; }
            elem.style.height = (crect.height - dh) + 'px';
        }
    };

    const resizeAsync = function() {
        if ( timer !== undefined ) { return; }
        timer = self.requestAnimationFrame(( ) => {
            timer = undefined;
            resize();
        });
    };

    resizeAsync();

    window.addEventListener('resize', resizeAsync, { passive: true });

    return resizeAsync;
})();

/******************************************************************************/

const grabView = function() {
    if ( logger.ownerId === undefined ) {
        logger.ownerId = Date.now();
    }
    readLogBuffer();
};

const releaseView = function() {
    if ( logger.ownerId === undefined ) { return; }
    vAPI.messaging.send('loggerUI', {
        what: 'releaseView',
        ownerId: logger.ownerId,
    });
    logger.ownerId = undefined;
};

window.addEventListener('pagehide', releaseView);
window.addEventListener('pageshow', grabView);
// https://bugzilla.mozilla.org/show_bug.cgi?id=1398625
window.addEventListener('beforeunload', releaseView);

/******************************************************************************/

uDom('#pageSelector').on('change', pageSelectorChanged);
uDom('#refresh').on('click', reloadTab);
uDom('#netInspector .vCompactToggler').on('click', toggleVCompactView);
uDom('#pause').on('click', pauseNetInspector);

// https://github.com/gorhill/uBlock/issues/507
//   Ensure tab selector is in sync with URL hash
pageSelectorFromURLHash();
window.addEventListener('hashchange', pageSelectorFromURLHash);

// Start to watch the current window geometry 2 seconds after the document
// is loaded, to be sure no spurious geometry changes will be triggered due
// to the window geometry pontentially not settling fast enough.
if ( self.location.search.includes('popup=1') ) {
    window.addEventListener(
        'load',
        ( ) => {
            setTimeout(
                ( ) => {
                    popupLoggerBox = {
                        x: self.screenX,
                        y: self.screenY,
                        w: self.outerWidth,
                        h: self.outerHeight,
                    };
            }, 2000);
        },
        { once: true }
    );
}

/******************************************************************************/

})();
