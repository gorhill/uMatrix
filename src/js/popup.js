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

/* global punycode, uDom, uMatrixScopeWidget */

'use strict';

/******************************************************************************/
/******************************************************************************/

{
// >>>>> start of local scope

/******************************************************************************/
/******************************************************************************/

// Stuff which is good to do very early so as to avoid visual glitches.

{
    const url = new URL(self.location.href);
    const params = url.searchParams;
    if ( params.has('tabid') || params.has('rule') ) {
        document.body.classList.add('embedded');
    }
    if ( params.has('rule') ) {
        document.body.classList.add('tabless');
    }

    const touchDevice = vAPI.localStorage.getItem('touchDevice');
    if ( touchDevice === 'true' ) {
        document.body.setAttribute('data-touch', 'true');
    } else {
        document.addEventListener('touchstart', function onTouched(ev) {
            document.removeEventListener(ev.type, onTouched);
            document.body.setAttribute('data-touch', 'true');
            vAPI.localStorage.setItem('touchDevice', 'true');
        });
    }
}

const popupWasResized = function() {
    document.body.setAttribute('data-resize-popup', '');
};

const resizePopup = (( ) => {
    let timer;

    // The purpose of `fix` is to make it so that the popup panel can still
    // function properly in a horizontally-restricted viewport: in such case
    // we need an horizontal scrollbar.
    const fix = function() {
        timer = undefined;
        document.body.classList.toggle(
            'hConstrained',
            window.innerWidth < document.body.clientWidth
        );
        popupWasResized();
    };

    // The purpose of `xobserver` is to initiate the resize handler only
    // when the popup panel is actually visible.
    let xobserver = new IntersectionObserver(intersections => {
        if ( intersections.length === 0 ) { return; }
        if ( intersections[0].isIntersecting === false ) { return; }
        xobserver.disconnect();
        xobserver = null;
        resizePopup();
    });
    xobserver.observe(document.body);

    return function() {
        if ( timer !== undefined ) {
            clearTimeout(timer);
        }
        if ( xobserver !== null ) { return; }
        timer = vAPI.setTimeout(fix, 97);
    };
})();

/******************************************************************************/
/******************************************************************************/

// Must be consistent with definitions in matrix.js
const Dark      = 0x80;
const Red       = 1;
const Green     = 2;
const DarkRed   = Dark | Red;
const DarkGreen = Dark | Green;

let matrixSnapshot = {};
let groupsSnapshot = [];
let allHostnamesSnapshot = 'do not leave this initial string empty';

let matrixCellHotspots = null;

const matrixHeaderPrettyNames = {
    'all': '',
    'cookie': '',
    'css': '',
    'image': '',
    'media': '',
    'script': '',
    'fetch': '',
    'frame': '',
    'other': ''
};

let firstPartyLabel = '';
let blacklistedHostnamesLabel = '';

const nodeToExpandosMap = new Map();
let expandosIdGenerator = 1;

const expandosFromNode = function(node) {
    if (
        node instanceof HTMLElement === false &&
        typeof node.nodeAt === 'function'
    ) {
        node = node.nodeAt(0);
    }
    if ( node.hasAttribute('data-expandos') === false ) {
        const expandosId = '' + (expandosIdGenerator++);
        node.setAttribute('data-expandos', expandosId);
        nodeToExpandosMap.set(expandosId, Object.create(null));
    }
    return nodeToExpandosMap.get(node.getAttribute('data-expandos'));
};

/******************************************************************************/
/******************************************************************************/

const getUserSetting = function(setting) {
    return matrixSnapshot.userSettings[setting];
};

const setUserSetting = function(setting, value) {
    matrixSnapshot.userSettings[setting] = value;
    vAPI.messaging.send('popup.js', {
        what: 'userSettings',
        name: setting,
        value: value
    });
};

/******************************************************************************/

const getUISetting = function(setting) {
    var r = vAPI.localStorage.getItem(setting);
    if ( typeof r !== 'string' ) {
        return undefined;
    }
    return JSON.parse(r);
};

const setUISetting = function(setting, value) {
    vAPI.localStorage.setItem(
        setting,
        JSON.stringify(value)
    );
};

/******************************************************************************/

const updateMatrixSnapshot = function() {
    matrixSnapshotPoller.pollNow();
};

/******************************************************************************/

// For display purpose, create four distinct groups of rows:
// 0th: literal "1st-party" row
// 1st: page domain's related
// 2nd: whitelisted
// 3rd: graylisted
// 4th: blacklisted

const getGroupStats = function() {
    // Try to not reshuffle groups around while popup is opened if
    // no new hostname added.
    const latestDomainListSnapshot = Object.keys(matrixSnapshot.rows).sort().join();
    if ( latestDomainListSnapshot === allHostnamesSnapshot ) {
        return groupsSnapshot;
    }
    allHostnamesSnapshot = latestDomainListSnapshot;

    // First, group according to whether at least one node in the domain
    // hierarchy is white or blacklisted
    const pageDomain = matrixSnapshot.domain;
    const rows = matrixSnapshot.rows;
    const anyTypeOffset = matrixSnapshot.headerIndices.get('*');
    const domainToGroupMap = {};

    // These have hard-coded position which cannot be overriden
    domainToGroupMap['1st-party'] = 0;
    domainToGroupMap[pageDomain] = 1;

    // 1st pass: domain wins if it has an explicit rule or a count
    for ( const hostname in rows ) {
        if ( rows.hasOwnProperty(hostname) === false ) { continue; }
        if ( hostname === '*' || hostname === '1st-party' ) { continue; }
        const domain = rows[hostname].domain;
        if ( domain === pageDomain || hostname !== domain ) { continue; }
        const row = rows[domain];
        const color = row.temporary[anyTypeOffset];
        if ( color === DarkGreen ) {
            domainToGroupMap[domain] = 2;
            continue;
        }
        if ( color === DarkRed ) {
            domainToGroupMap[domain] = 4;
            continue;
        }
        const count = row.counts[anyTypeOffset];
        if ( count !== 0 ) {
            domainToGroupMap[domain] = 3;
            continue;
        }
    }
    // 2nd pass: green wins
    for ( const hostname in rows ) {
        if ( rows.hasOwnProperty(hostname) === false ) { continue; }
        const row = rows[hostname];
        const domain = row.domain;
        if ( domainToGroupMap.hasOwnProperty(domain) ) { continue; }
        const color = row.temporary[anyTypeOffset];
        if ( color === DarkGreen ) {
            domainToGroupMap[domain] = 2;
        }
    }
    // 3rd pass: gray with count wins
    for ( const hostname in rows ) {
        if ( rows.hasOwnProperty(hostname) === false ) { continue; }
        const row = rows[hostname];
        const domain = row.domain;
        if ( domainToGroupMap.hasOwnProperty(domain) ) { continue; }
        const color = row.temporary[anyTypeOffset];
        const count = row.counts[anyTypeOffset];
        if ( color !== DarkRed && count !== 0 ) {
            domainToGroupMap[domain] = 3;
        }
    }
    // 4th pass: red wins whatever is left
    for ( const hostname in rows ) {
        if ( rows.hasOwnProperty(hostname) === false ) { continue; }
        const row = rows[hostname];
        const domain = row.domain;
        if ( domainToGroupMap.hasOwnProperty(domain) ) { continue; }
        const color = row.temporary[anyTypeOffset];
        if ( color === DarkRed ) {
            domainToGroupMap[domain] = 4;
        }
    }
    // 5th pass: gray wins whatever is left
    for ( const hostname in rows ) {
        if ( rows.hasOwnProperty(hostname) === false ) { continue; }
        const domain = rows[hostname].domain;
        if ( domainToGroupMap.hasOwnProperty(domain) ) { continue; }
        domainToGroupMap[domain] = 3;
    }

    // Last pass: put each domain in a group
    const groups = [ {}, {}, {}, {}, {} ];
    for ( const hostname in rows ) {
        if ( rows.hasOwnProperty(hostname) === false ) { continue; }
        if ( hostname === '*' ) { continue; }
        const domain = rows[hostname].domain;
        const groupIndex = domainToGroupMap[domain];
        const group = groups[groupIndex];
        if ( group.hasOwnProperty(domain) === false ) {
            group[domain] = {};
        }
        group[domain][hostname] = true;
    }

    groupsSnapshot = groups;

    return groups;
};

/******************************************************************************/

// helpers

const getTemporaryColor = function(hostname, type) {
    return matrixSnapshot.rows[hostname]
                         .temporary[matrixSnapshot.headerIndices.get(type)];
};

const getPermanentColor = function(hostname, type) {
    return matrixSnapshot.rows[hostname]
                         .permanent[matrixSnapshot.headerIndices.get(type)];
};

const addCellClass = function(cell, hostname, type) {
    const cl = cell.classList;
    cl.add('matCell');
    cl.add('t' + getTemporaryColor(hostname, type).toString(16));
    cl.add('p' + getPermanentColor(hostname, type).toString(16));
};

/******************************************************************************/

// This is required for when we update the matrix while it is open:
// the user might have collapsed/expanded one or more domains, and we don't
// want to lose all his hardwork.

const getCollapseState = function(domain) {
    const states = getUISetting('popupCollapseSpecificDomains');
    if ( typeof states === 'object' && states[domain] !== undefined ) {
        return states[domain];
    }
    return matrixSnapshot.collapseAllDomains === true;
};

const toggleCollapseState = function(elem) {
    if ( elem.ancestors('#matHead.collapsible').length > 0 ) {
        toggleMainCollapseState(elem);
    } else {
        toggleSpecificCollapseState(elem);
    }
    popupWasResized();
};

const toggleMainCollapseState = function(uelem) {
    const matHead = uelem.ancestors('#matHead.collapsible').toggleClass('collapsed');
    const collapsed = matrixSnapshot.collapseAllDomains = matHead.hasClass('collapsed');
    uDom('#matList .matSection.collapsible').toggleClass('collapsed', collapsed);
    setUserSetting('popupCollapseAllDomains', collapsed);
    const specificCollapseStates = getUISetting('popupCollapseSpecificDomains') || {};
    for ( const domain of Object.keys(specificCollapseStates) ) {
        if ( specificCollapseStates[domain] === collapsed ) {
            delete specificCollapseStates[domain];
        }
    }
    setUISetting('popupCollapseSpecificDomains', specificCollapseStates);
};

const toggleSpecificCollapseState = function(uelem) {
    // Remember collapse state forever, but only if it is different
    // from main collapse switch.
    const section = uelem.ancestors('.matSection.collapsible').toggleClass('collapsed');
    const domain = expandosFromNode(section).domain;
    const collapsed = section.hasClass('collapsed');
    const mainCollapseState = matrixSnapshot.collapseAllDomains === true;
    const specificCollapseStates = getUISetting('popupCollapseSpecificDomains') || {};
    if ( collapsed !== mainCollapseState ) {
        specificCollapseStates[domain] = collapsed;
        setUISetting('popupCollapseSpecificDomains', specificCollapseStates);
    } else if ( specificCollapseStates[domain] !== undefined ) {
        delete specificCollapseStates[domain];
        setUISetting('popupCollapseSpecificDomains', specificCollapseStates);
    }
};

/******************************************************************************/

// Update count value of matrix cells(s)

const updateMatrixCounts = function() {
    const matCells = uDom('.matrix .matRow.rw > .matCell');
    const headerIndices = matrixSnapshot.headerIndices;
    const rows = matrixSnapshot.rows;
    let i = matCells.length;
    while ( i-- ) {
        const matCell = matCells.nodeAt(i);
        const expandos = expandosFromNode(matCell);
        if ( expandos.hostname === '*' || expandos.reqType === '*' ) {
            continue;
        }
        const matRow = matCell.parentNode;
        const counts = matRow.classList.contains('meta') ? 'totals' : 'counts';
        const count = rows[expandos.hostname][counts][headerIndices.get(expandos.reqType)];
        if ( count === expandos.count ) { continue; }
        expandos.count = count;
        matCell.textContent = cellTextFromCount(count);
    }
};

const cellTextFromCount = function(count) {
    if ( count === 0 ) { return '\u00A0'; }
    if ( count < 100 ) { return count; }
    return '99+';
};

/******************************************************************************/

// Update color of matrix cells(s)
// Color changes when rules change

const updateMatrixColors = function() {
    const cells = uDom('.matrix .matRow.rw > .matCell').removeClass();
    for ( let i = 0; i < cells.length; i++ ) {
        const cell = cells.nodeAt(i);
        const expandos = expandosFromNode(cell);
        addCellClass(cell, expandos.hostname, expandos.reqType);
    }
    popupWasResized();
};

/******************************************************************************/

// Update behavior of matrix:
// - Whether a section is collapsible or not. It is collapsible if:
//   - It has at least one subdomain AND
//   - There is no explicit rule anywhere in the subdomain cells AND
//   - It is not part of group 3 (blacklisted hostnames)

const updateMatrixBehavior = function() {
    matrixList = matrixList || uDom('#matList');
    const sections = matrixList.descendants('.matSection');
    let i = sections.length;
    while ( i-- ) {
        const section = sections.at(i);
        const subdomainRows = section.descendants('.l2:not(.g4)');
        let j = subdomainRows.length;
        while ( j-- ) {
            const subdomainRow = subdomainRows.at(j);
            subdomainRow.toggleClass(
                'collapsible',
                subdomainRow.descendants('.t81,.t82').length === 0
            );
        }
        section.toggleClass(
            'collapsible',
            subdomainRows.filter('.collapsible').length > 0
        );
    }
};

/******************************************************************************/

// handle user interaction with filters

const getCellAction = function(hostname, type, leaning) {
    const temporaryColor = getTemporaryColor(hostname, type);
    const hue = temporaryColor & 0x03;
    // Special case: root toggle only between two states
    if ( type === '*' && hostname === '*' ) {
        return hue === Green ? 'blacklistMatrixCell' : 'whitelistMatrixCell';
    }
    // When explicitly blocked/allowed, can only graylist
    const saturation = temporaryColor & 0x80;
    if ( saturation === Dark ) {
        return 'graylistMatrixCell';
    }
    return leaning === 'whitelisting' ? 'whitelistMatrixCell' : 'blacklistMatrixCell';
};

const handleFilter = function(button, leaning) {
    // our parent cell knows who we are
    const cell = button.ancestors('div.matCell');
    const expandos = expandosFromNode(cell);
    const type = expandos.reqType;
    const desHostname = expandos.hostname;
    // https://github.com/gorhill/uMatrix/issues/24
    // No hostname can happen -- like with blacklist meta row
    if ( desHostname === '' ) { return; }
    vAPI.messaging.send('default', {
        what: getCellAction(desHostname, type, leaning),
        srcHostname: matrixSnapshot.scope,
        desHostname: desHostname,
        type: type
    }).then(( ) => {
        updateMatrixSnapshot();
    });
};

const handleWhitelistFilter = function(button) {
    handleFilter(button, 'whitelisting');
};

const handleBlacklistFilter = function(button) {
    handleFilter(button, 'blacklisting');
};

/******************************************************************************/

let matrixRowPool = [];
let matrixSectionPool = [];
let matrixGroupPool = [];
let matrixRowTemplate = null;
let matrixList = null;

const startMatrixUpdate = function() {
    matrixList =  matrixList || uDom('#matList');
    matrixList.detach();
    const rows = matrixList.descendants('.matRow');
    rows.detach();
    matrixRowPool = matrixRowPool.concat(rows.toArray());
    const sections = matrixList.descendants('.matSection');
    sections.detach();
    matrixSectionPool = matrixSectionPool.concat(sections.toArray());
    const groups = matrixList.descendants('.matGroup');
    groups.detach();
    matrixGroupPool = matrixGroupPool.concat(groups.toArray());
};

const endMatrixUpdate = function() {
    // https://github.com/gorhill/httpswitchboard/issues/246
    // If the matrix has no rows, we need to insert a dummy one, invisible,
    // to ensure the extension pop-up is properly sized. This is needed because
    // the header pane's `position` property is `fixed`, which means it doesn't
    // affect layout size, hence the matrix header row will be truncated.
    if ( matrixSnapshot.rowCount <= 1 ) {
        matrixList.append(createMatrixRow().css('visibility', 'hidden'));
    }
    updateMatrixBehavior();
    matrixList.css('display', '');
    matrixList.appendTo('.paneContent');
};

const createMatrixGroup = function() {
    const group = matrixGroupPool.pop();
    if ( group ) {
        return uDom(group).removeClass().addClass('matGroup');
    }
    return uDom(document.createElement('div')).addClass('matGroup');
};

const createMatrixSection = function() {
    const section = matrixSectionPool.pop();
    if ( section ) {
        return uDom(section).removeClass().addClass('matSection');
    }
    return uDom(document.createElement('div')).addClass('matSection');
};

const createMatrixRow = function() {
    let row = matrixRowPool.pop();
    if ( row ) {
        row.style.visibility = '';
        row = uDom(row);
        row.descendants('.matCell').removeClass().addClass('matCell');
        row.removeClass().addClass('matRow');
        return row;
    }
    if ( matrixRowTemplate === null ) {
        matrixRowTemplate = uDom('#templates .matRow');
    }
    return matrixRowTemplate.clone();
};

/******************************************************************************/

const renderMatrixHeaderRow = function() {
    const matHead = uDom('#matHead.collapsible');
    matHead.toggleClass('collapsed', matrixSnapshot.collapseAllDomains === true);
    const cells = matHead.descendants('.matCell');
    cells.removeClass();
    let cell = cells.nodeAt(0);
    let expandos = expandosFromNode(cell);
    expandos.reqType = '*';
    expandos.hostname = '*';
    addCellClass(cell, '*', '*');
    cell = cells.nodeAt(1);
    expandos = expandosFromNode(cell);
    expandos.reqType = 'cookie';
    expandos.hostname = '*';
    addCellClass(cell, '*', 'cookie');
    cell = cells.nodeAt(2);
    expandos = expandosFromNode(cell);
    expandos.reqType = 'css';
    expandos.hostname = '*';
    addCellClass(cell, '*', 'css');
    cell = cells.nodeAt(3);
    expandos = expandosFromNode(cell);
    expandos.reqType = 'image';
    expandos.hostname = '*';
    addCellClass(cell, '*', 'image');
    cell = cells.nodeAt(4);
    expandos = expandosFromNode(cell);
    expandos.reqType = 'media';
    expandos.hostname = '*';
    addCellClass(cell, '*', 'media');
    cell = cells.nodeAt(5);
    expandos = expandosFromNode(cell);
    expandos.reqType = 'script';
    expandos.hostname = '*';
    addCellClass(cell, '*', 'script');
    cell = cells.nodeAt(6);
    expandos = expandosFromNode(cell);
    expandos.reqType = 'fetch';
    expandos.hostname = '*';
    addCellClass(cell, '*', 'fetch');
    cell = cells.nodeAt(7);
    expandos = expandosFromNode(cell);
    expandos.reqType = 'frame';
    expandos.hostname = '*';
    addCellClass(cell, '*', 'frame');
    cell = cells.nodeAt(8);
    expandos = expandosFromNode(cell);
    expandos.reqType = 'other';
    expandos.hostname = '*';
    addCellClass(cell, '*', 'other');
    uDom('#matHead .matRow').css('display', '');
};

/******************************************************************************/

const renderMatrixCellDomain = function(cell, domain) {
    const expandos = expandosFromNode(cell);
    expandos.hostname = domain;
    expandos.reqType = '*';
    addCellClass(cell.nodeAt(0), domain, '*');
    const contents = cell.contents();
    contents.nodeAt(0).textContent = domain === '1st-party' ?
        firstPartyLabel :
        punycode.toUnicode(domain);
    contents.nodeAt(1).textContent = ' ';
};

const renderMatrixCellSubdomain = function(cell, domain, subomain) {
    const expandos = expandosFromNode(cell);
    expandos.hostname = subomain;
    expandos.reqType = '*';
    addCellClass(cell.nodeAt(0), subomain, '*');
    const contents = cell.contents();
    contents.nodeAt(0).textContent = punycode.toUnicode(subomain.slice(0, subomain.lastIndexOf(domain)-1)) + '.';
    contents.nodeAt(1).textContent = punycode.toUnicode(domain);
};

const renderMatrixMetaCellDomain = function(cell, domain) {
    const expandos = expandosFromNode(cell);
    expandos.hostname = domain;
    expandos.reqType = '*';
    addCellClass(cell.nodeAt(0), domain, '*');
    const contents = cell.contents();
    contents.nodeAt(0).textContent = '\u2217.' + punycode.toUnicode(domain);
    contents.nodeAt(1).textContent = ' ';
};

const renderMatrixCellType = function(cell, hostname, type, count) {
    const node = cell.nodeAt(0);
    const expandos = expandosFromNode(node);
    expandos.hostname = hostname;
    expandos.reqType = type;
    expandos.count = count;
    addCellClass(node, hostname, type);
    node.textContent = cellTextFromCount(count);
};

const renderMatrixCellTypes = function(cells, hostname, countName) {
    const counts = matrixSnapshot.rows[hostname][countName];
    const headerIndices = matrixSnapshot.headerIndices;
    renderMatrixCellType(cells.at(1), hostname, 'cookie', counts[headerIndices.get('cookie')]);
    renderMatrixCellType(cells.at(2), hostname, 'css', counts[headerIndices.get('css')]);
    renderMatrixCellType(cells.at(3), hostname, 'image', counts[headerIndices.get('image')]);
    renderMatrixCellType(cells.at(4), hostname, 'media', counts[headerIndices.get('media')]);
    renderMatrixCellType(cells.at(5), hostname, 'script', counts[headerIndices.get('script')]);
    renderMatrixCellType(cells.at(6), hostname, 'fetch', counts[headerIndices.get('fetch')]);
    renderMatrixCellType(cells.at(7), hostname, 'frame', counts[headerIndices.get('frame')]);
    renderMatrixCellType(cells.at(8), hostname, 'other', counts[headerIndices.get('other')]);
};

/******************************************************************************/

const makeMatrixRowDomain = function(domain) {
    const matrixRow = createMatrixRow().addClass('rw');
    const cells = matrixRow.descendants('.matCell');
    renderMatrixCellDomain(cells.at(0), domain);
    renderMatrixCellTypes(cells, domain, 'counts');
    return matrixRow;
};

const makeMatrixRowSubdomain = function(domain, subdomain) {
    const matrixRow = createMatrixRow().addClass('rw');
    const cells = matrixRow.descendants('.matCell');
    renderMatrixCellSubdomain(cells.at(0), domain, subdomain);
    renderMatrixCellTypes(cells, subdomain, 'counts');
    return matrixRow;
};

const makeMatrixMetaRowDomain = function(domain) {
    const matrixRow = createMatrixRow().addClass('rw');
    const cells = matrixRow.descendants('.matCell');
    renderMatrixMetaCellDomain(cells.at(0), domain);
    renderMatrixCellTypes(cells, domain, 'totals');
    return matrixRow;
};

/******************************************************************************/

const renderMatrixMetaCellType = function(cell, count) {
    // https://github.com/gorhill/uMatrix/issues/24
    // Don't forget to reset cell properties
    const node = cell.nodeAt(0);
    const expandos = expandosFromNode(node);
    expandos.hostname = '';
    expandos.reqType = '';
    expandos.count = count;
    cell.addClass('t1');
    node.textContent = cellTextFromCount(count);
};

const makeMatrixMetaRow = function(totals) {
    const headerIndices = matrixSnapshot.headerIndices;
    const matrixRow = createMatrixRow().at(0).addClass('ro');
    const cells = matrixRow.descendants('.matCell');
    const contents = cells.at(0).addClass('t81').contents();
    const expandos = expandosFromNode(cells.nodeAt(0));
    expandos.hostname = '';
    expandos.reqType = '*';
    contents.nodeAt(0).textContent = ' ';
    contents.nodeAt(1).textContent = blacklistedHostnamesLabel.replace(
        '{{count}}',
        totals[headerIndices.get('*')].toLocaleString()
    );
    renderMatrixMetaCellType(cells.at(1), totals[headerIndices.get('cookie')]);
    renderMatrixMetaCellType(cells.at(2), totals[headerIndices.get('css')]);
    renderMatrixMetaCellType(cells.at(3), totals[headerIndices.get('image')]);
    renderMatrixMetaCellType(cells.at(4), totals[headerIndices.get('media')]);
    renderMatrixMetaCellType(cells.at(5), totals[headerIndices.get('script')]);
    renderMatrixMetaCellType(cells.at(6), totals[headerIndices.get('fetch')]);
    renderMatrixMetaCellType(cells.at(7), totals[headerIndices.get('frame')]);
    renderMatrixMetaCellType(cells.at(8), totals[headerIndices.get('other')]);
    return matrixRow;
};

/******************************************************************************/

const computeMatrixGroupMetaStats = function(group) {
    const headerIndices = matrixSnapshot.headerIndices;
    const anyTypeIndex = headerIndices.get('*');
    const n = headerIndices.size;
    const totals = new Array(n);
    totals.fill(0);
    const rows = matrixSnapshot.rows;
    for ( const hostname in rows ) {
        if ( rows.hasOwnProperty(hostname) === false ) { continue; }
        const row = rows[hostname];
        if ( group.hasOwnProperty(row.domain) === false ) { continue; }
        if ( row.counts[anyTypeIndex] === 0 ) { continue; }
        totals[0] += 1;
        for ( let i = 1; i < n; i++ ) {
            totals[i] += row.counts[i];
        }
    }
    return totals;
};

/******************************************************************************/

// Compare hostname helper, to order hostname in a logical manner:
// top-most < bottom-most, take into account whether IP address or
// named hostname

const hostnameCompare = function(a,b) {
    // Normalize: most significant parts first
    if ( !a.match(/^\d+(\.\d+){1,3}$/) ) {
        const aa = a.split('.');
        a = aa.slice(-2).concat(aa.slice(0,-2).reverse()).join('.');
    }
    if ( !b.match(/^\d+(\.\d+){1,3}$/) ) {
        const bb = b.split('.');
        b = bb.slice(-2).concat(bb.slice(0,-2).reverse()).join('.');
    }
    return a.localeCompare(b);
};

/******************************************************************************/

const makeMatrixGroup0SectionDomain = function() {
    return makeMatrixRowDomain('1st-party').addClass('g0 l1');
};

const makeMatrixGroup0Section = function() {
    const domainDiv = createMatrixSection();
    expandosFromNode(domainDiv).domain = '1st-party';
    makeMatrixGroup0SectionDomain().appendTo(domainDiv);
    return domainDiv;
};

const makeMatrixGroup0 = function() {
    // Show literal "1st-party" row only if there is 
    // at least one 1st-party hostname
    if ( Object.keys(groupsSnapshot[1]).length === 0 ) {
        return;
    }
    const groupDiv = createMatrixGroup().addClass('g0');
    makeMatrixGroup0Section().appendTo(groupDiv);
    groupDiv.appendTo(matrixList);
};

/******************************************************************************/

const makeMatrixGroup1SectionDomain = function(domain) {
    return makeMatrixRowDomain(domain)
        .addClass('g1 l1');
};

const makeMatrixGroup1SectionSubomain = function(domain, subdomain) {
    return makeMatrixRowSubdomain(domain, subdomain)
        .addClass('g1 l2');
};

const makeMatrixGroup1SectionMetaDomain = function(domain) {
    return makeMatrixMetaRowDomain(domain)
        .addClass('g1 l1 meta');
};

const makeMatrixGroup1Section = function(hostnames) {
    const domain = hostnames[0];
    const domainDiv = createMatrixSection().toggleClass(
        'collapsed',
        getCollapseState(domain)
    );
    expandosFromNode(domainDiv).domain = domain;
    if ( hostnames.length > 1 ) {
        makeMatrixGroup1SectionMetaDomain(domain).appendTo(domainDiv);
    }
    makeMatrixGroup1SectionDomain(domain).appendTo(domainDiv);
    for ( let i = 1; i < hostnames.length; i++ ) {
        makeMatrixGroup1SectionSubomain(domain, hostnames[i])
            .appendTo(domainDiv);
    }
    return domainDiv;
};

const makeMatrixGroup1 = function(group) {
    const domains = Object.keys(group).sort(hostnameCompare);
    if ( domains.length ) {
        const groupDiv = createMatrixGroup().addClass('g1');
        makeMatrixGroup1Section(Object.keys(group[domains[0]]).sort(hostnameCompare))
            .appendTo(groupDiv);
        for ( let i = 1; i < domains.length; i++ ) {
            makeMatrixGroup1Section(Object.keys(group[domains[i]]).sort(hostnameCompare))
                .appendTo(groupDiv);
        }
        groupDiv.appendTo(matrixList);
    }
};

/******************************************************************************/

const makeMatrixGroup2SectionDomain = function(domain) {
    return makeMatrixRowDomain(domain)
        .addClass('g2 l1');
};

const makeMatrixGroup2SectionSubomain = function(domain, subdomain) {
    return makeMatrixRowSubdomain(domain, subdomain)
        .addClass('g2 l2');
};

const makeMatrixGroup2SectionMetaDomain = function(domain) {
    return makeMatrixMetaRowDomain(domain).addClass('g2 l1 meta');
};

const makeMatrixGroup2Section = function(hostnames) {
    const domain = hostnames[0];
    const domainDiv = createMatrixSection()
        .toggleClass('collapsed', getCollapseState(domain));
    expandosFromNode(domainDiv).domain = domain;
    if ( hostnames.length > 1 ) {
        makeMatrixGroup2SectionMetaDomain(domain).appendTo(domainDiv);
    }
    makeMatrixGroup2SectionDomain(domain)
        .appendTo(domainDiv);
    for ( let i = 1; i < hostnames.length; i++ ) {
        makeMatrixGroup2SectionSubomain(domain, hostnames[i])
            .appendTo(domainDiv);
    }
    return domainDiv;
};

const makeMatrixGroup2 = function(group) {
    const domains = Object.keys(group).sort(hostnameCompare);
    if ( domains.length) {
        const groupDiv = createMatrixGroup()
            .addClass('g2');
        makeMatrixGroup2Section(Object.keys(group[domains[0]]).sort(hostnameCompare))
            .appendTo(groupDiv);
        for ( let i = 1; i < domains.length; i++ ) {
            makeMatrixGroup2Section(Object.keys(group[domains[i]]).sort(hostnameCompare))
                .appendTo(groupDiv);
        }
        groupDiv.appendTo(matrixList);
    }
};

/******************************************************************************/

const makeMatrixGroup3SectionDomain = function(domain) {
    return makeMatrixRowDomain(domain)
        .addClass('g3 l1');
};

const makeMatrixGroup3SectionSubomain = function(domain, subdomain) {
    return makeMatrixRowSubdomain(domain, subdomain)
        .addClass('g3 l2');
};

const makeMatrixGroup3SectionMetaDomain = function(domain) {
    return makeMatrixMetaRowDomain(domain).addClass('g3 l1 meta');
};

const makeMatrixGroup3Section = function(hostnames) {
    const domain = hostnames[0];
    const domainDiv = createMatrixSection()
        .toggleClass('collapsed', getCollapseState(domain));
    expandosFromNode(domainDiv).domain = domain;
    if ( hostnames.length > 1 ) {
        makeMatrixGroup3SectionMetaDomain(domain).appendTo(domainDiv);
    }
    makeMatrixGroup3SectionDomain(domain)
        .appendTo(domainDiv);
    for ( let i = 1; i < hostnames.length; i++ ) {
        makeMatrixGroup3SectionSubomain(domain, hostnames[i])
            .appendTo(domainDiv);
    }
    return domainDiv;
};

const makeMatrixGroup3 = function(group) {
    const domains = Object.keys(group).sort(hostnameCompare);
    if ( domains.length) {
        const groupDiv = createMatrixGroup()
            .addClass('g3');
        makeMatrixGroup3Section(Object.keys(group[domains[0]]).sort(hostnameCompare))
            .appendTo(groupDiv);
        for ( let i = 1; i < domains.length; i++ ) {
            makeMatrixGroup3Section(Object.keys(group[domains[i]]).sort(hostnameCompare))
                .appendTo(groupDiv);
        }
        groupDiv.appendTo(matrixList);
    }
};

/******************************************************************************/

const makeMatrixGroup4SectionDomain = function(domain) {
    return makeMatrixRowDomain(domain)
        .addClass('g4 l1');
};

const makeMatrixGroup4SectionSubomain = function(domain, subdomain) {
    return makeMatrixRowSubdomain(domain, subdomain)
        .addClass('g4 l2');
};

const makeMatrixGroup4Section = function(hostnames) {
    const domain = hostnames[0];
    const domainDiv = createMatrixSection();
    expandosFromNode(domainDiv).domain = domain;
    makeMatrixGroup4SectionDomain(domain)
        .appendTo(domainDiv);
    for ( let i = 1; i < hostnames.length; i++ ) {
        makeMatrixGroup4SectionSubomain(domain, hostnames[i])
            .appendTo(domainDiv);
    }
    return domainDiv;
};

const makeMatrixGroup4 = function(group) {
    const domains = Object.keys(group).sort(hostnameCompare);
    if ( domains.length === 0 ) { return; }
    const groupDiv = createMatrixGroup().addClass('g4');
    createMatrixSection()
        .addClass('g4Meta')
        .toggleClass('g4Collapsed', !!matrixSnapshot.collapseBlacklistedDomains)
        .appendTo(groupDiv);
    makeMatrixMetaRow(computeMatrixGroupMetaStats(group), 'g4')
        .appendTo(groupDiv);
    makeMatrixGroup4Section(Object.keys(group[domains[0]]).sort(hostnameCompare))
        .appendTo(groupDiv);
    for ( let i = 1; i < domains.length; i++ ) {
        makeMatrixGroup4Section(Object.keys(group[domains[i]]).sort(hostnameCompare))
            .appendTo(groupDiv);
    }
    groupDiv.appendTo(matrixList);
};

/******************************************************************************/

const makeMenu = function() {
    const groupStats = getGroupStats();

    if ( Object.keys(groupStats).length === 0 ) { return; }

    // https://github.com/gorhill/httpswitchboard/issues/31
    if ( matrixCellHotspots ) {
        matrixCellHotspots.detach();
    }

    renderMatrixHeaderRow();

    startMatrixUpdate();
    makeMatrixGroup0(groupStats[0]);
    makeMatrixGroup1(groupStats[1]);
    makeMatrixGroup2(groupStats[2]);
    makeMatrixGroup3(groupStats[3]);
    makeMatrixGroup4(groupStats[4]);
    endMatrixUpdate();

    uMatrixScopeWidget.init(
        matrixSnapshot.domain,
        matrixSnapshot.hostname,
        matrixSnapshot.scope
    );
    updateMatrixButtons();
    resizePopup();
    recipeManager.fetch();
};

/******************************************************************************/

// Do all the stuff that needs to be done before building menu et al.

const initMenuEnvironment = function() {
    document.body.style.setProperty(
        'font-size',
        getUserSetting('displayTextSize')
    );
    uDom.nodeFromId('version').textContent = matrixSnapshot.appVersion || '';
    document.body.classList.toggle(
        'colorblind',
        getUserSetting('colorBlindFriendly')
    );
    document.body.classList.toggle(
        'noTooltips',
        getUserSetting('noTooltips')
    );

    const prettyNames = matrixHeaderPrettyNames;
    const keys = Object.keys(prettyNames);
    let i = keys.length;
    while ( i-- ) {
        const key = keys[i];
        const cell = uDom('#matHead .matCell[data-req-type="'+ key +'"]');
        const text = vAPI.i18n(key + 'PrettyName');
        cell.text(text);
        prettyNames[key] = text;
    }

    firstPartyLabel = uDom('[data-i18n="matrix1stPartyLabel"]').text();
    blacklistedHostnamesLabel = uDom('[data-i18n="matrixBlacklistedHostnames"]').text();
};

/******************************************************************************/

const scopeChangeHandler = function(ev) {
    const newScope = ev.detail.scope;
    if ( !newScope || matrixSnapshot.scope === newScope ) { return; }
    matrixSnapshot.scope = newScope;
    matrixSnapshot.tMatrixModifiedTime = undefined;
    updateMatrixSnapshot();
    dropDownMenuHide();
};

/******************************************************************************/

const updateMatrixSwitches = function() {
    const switches = matrixSnapshot.tSwitches;
    let count = 0;
    for ( const switchName in switches ) {
        if ( switches.hasOwnProperty(switchName) === false ) { continue; }
        const enabled = switches[switchName];
        if ( enabled && switchName !== 'matrix-off' ) {
            count += 1;
        }
        uDom('#mtxSwitch_' + switchName).toggleClass('switchTrue', enabled);
    }
    uDom.nodeFromId('mtxSwitch_https-strict').classList.toggle(
        'relevant',
        matrixSnapshot.hasMixedContent === true
    );
    uDom.nodeFromId('mtxSwitch_no-workers').classList.toggle(
        'relevant',
        matrixSnapshot.hasWebWorkers === true
    );
    uDom.nodeFromId('mtxSwitch_referrer-spoof').classList.toggle(
        'relevant',
        matrixSnapshot.has3pReferrer === true
    );
    uDom.nodeFromId('mtxSwitch_noscript-spoof').classList.toggle(
        'relevant',
        matrixSnapshot.hasNoscriptTags === true
    );
    uDom.nodeFromId('mtxSwitch_cname-reveal').classList.toggle(
        'relevant',
        matrixSnapshot.hasHostnameAliases === true
    );
    uDom.nodeFromSelector('#buttonMtxSwitches .fa-icon-badge').textContent =
        count.toLocaleString();
    uDom.nodeFromSelector('#mtxSwitch_matrix-off .fa-icon-badge').textContent =
        matrixSnapshot.blockedCount.toLocaleString();
    document.body.classList.toggle('powerOff', switches['matrix-off']);
};

const toggleMatrixSwitch = function(ev) {
    if ( ev.target.localName === 'a' ) { return; }
    const elem = ev.currentTarget;
    const pos = elem.id.indexOf('_');
    if ( pos === -1 ) { return; }
    const switchName = elem.id.slice(pos + 1);
    vAPI.messaging.send('popup.js', {
        what: 'toggleMatrixSwitch',
        switchName: switchName,
        srcHostname: matrixSnapshot.scope,
    }).then(( ) => {
        updateMatrixSnapshot();
    });
};

/******************************************************************************/

const updatePersistButton = function() {
    const diffCount = matrixSnapshot.diff.length;
    const button = uDom('#buttonPersist');
    button.contents()
          .filter(function(){return this.nodeType===3;})
          .first()
          .text(diffCount > 0 ? '\uf13e' : '\uf023');
    button.descendants('.fa-icon-badge').text(diffCount > 0 ? diffCount : '');
    const disabled = diffCount === 0;
    button.toggleClass('disabled', disabled);
    uDom('#buttonRevertScope').toggleClass('disabled', disabled);
};

/******************************************************************************/

const persistMatrix = function() {
    vAPI.messaging.send('popup.js', {
        what: 'applyDiffToPermanentMatrix',
        diff: matrixSnapshot.diff,
    }).then(( ) => {
        updateMatrixSnapshot();
    });
};

/******************************************************************************/

// rhill 2014-03-12: revert completely ALL changes related to the
// current page, including scopes.

const revertMatrix = function() {
    vAPI.messaging.send('popup.js', {
        what: 'applyDiffToTemporaryMatrix',
        diff: matrixSnapshot.diff,
    }).then(( ) => {
        updateMatrixSnapshot();
    });
};

/******************************************************************************/

// Buttons which are affected by any changes in the matrix

const updateMatrixButtons = function() {
    uMatrixScopeWidget.update(matrixSnapshot.scope);
    updateMatrixSwitches();
    updatePersistButton();
};

/******************************************************************************/

uDom('#buttonReload').on('click', ev => {
    vAPI.messaging.send('default', {
        what: 'forceReloadTab',
        tabId: matrixSnapshot.tabId,
        bypassCache: ev.ctrlKey || ev.metaKey || ev.shiftKey
    });
});

/******************************************************************************/

const recipeManager = (( ) => {
    const reScopeAlias = /(^|\s+)_(\s+|$)/g;
    let recipes = [];

    const createEntry = function(name, ruleset, parent) {
        const li = document.querySelector('#templates li.recipe')
                         .cloneNode(true);
        li.querySelector('.name').textContent = name;
        li.querySelector('.ruleset').textContent = ruleset;
        if ( parent ) {
            parent.appendChild(li);
        }
        return li;
    };

    const apply = function(ev) {
        if (
            ev.target.classList.contains('expander') ||
            ev.target.classList.contains('name')
        ) {
            ev.currentTarget.classList.toggle('expanded');
            return;
        }
        if (
            ev.target.classList.contains('importer') === false &&
            ev.target.classList.contains('committer') === false
        ) {
            return;
        }
        const root = ev.currentTarget;
        const ruleset = root.querySelector('.ruleset');
        const commit = ev.target.classList.contains('committer');
        vAPI.messaging.send('popup.js', {
            what: 'applyRecipe',
            ruleset: ruleset.textContent,
            commit,
        }).then(( ) => {
            updateMatrixSnapshot();
        });
        root.classList.remove('mustImport');
        if ( commit ) {
            root.classList.remove('mustCommit');
        }
        //dropDownMenuHide();
    };

    const show = function(details) {
        const root = document.querySelector('#dropDownMenuRecipes .dropdown-menu');
        const ul = document.createElement('ul');
        for ( const recipe of details.recipes ) {
            let li = createEntry(
                recipe.name,
                recipe.ruleset.replace(reScopeAlias, '$1' + details.scope + '$2'),
                ul
            );
            li.classList.toggle('mustImport', recipe.mustImport === true);
            li.classList.toggle('mustCommit', recipe.mustCommit === true);
            li.addEventListener('click', apply);
        }
        root.replaceChild(ul, root.querySelector('ul'));
        dropDownMenuShow(uDom.nodeFromId('buttonRecipes'));
    };

    const beforeShow = async function() {
        if ( recipes.length === 0 ) { return; }
        const details = await vAPI.messaging.send('popup.js', {
            what: 'fetchRecipeCommitStatuses',
            scope: matrixSnapshot.scope,
            recipes: recipes,
        });
        show(details);
    };

    const fetch = async function() {
        const desHostnames = [];
        for ( const hostname in matrixSnapshot.rows ) {
            if ( matrixSnapshot.rows.hasOwnProperty(hostname) === false ) {
                continue;
            }
            const row = matrixSnapshot.rows[hostname];
            if ( row.domain === matrixSnapshot.domain ) { continue; }
            if ( row.counts[0] !== 0 || row.domain === hostname ) {
                desHostnames.push(hostname);
            }
        }
        const response = await vAPI.messaging.send('popup.js', {
            what: 'fetchRecipes',
            srcHostname: matrixSnapshot.hostname,
            desHostnames: desHostnames
        });
        recipes = Array.isArray(response) ? response : [];
        const button = uDom.nodeFromId('buttonRecipes');
        if ( recipes.length === 0 ) {
            button.classList.add('disabled');
            return;
        }
        button.classList.remove('disabled');
        button.querySelector('.fa-icon-badge').textContent = recipes.length;
    };

    return { fetch, show: beforeShow, apply };
})();

/******************************************************************************/

const revertAll = function() {
    vAPI.messaging.send('popup.js', {
        what: 'revertTemporaryMatrix'
    }).then(( ) => {
        updateMatrixSnapshot();
    });
};

/******************************************************************************/

const mouseenterMatrixCellHandler = function(ev) {
    matrixCellHotspots.appendTo(ev.target);
};

const mouseleaveMatrixCellHandler = function() {
    matrixCellHotspots.detach();
};

/******************************************************************************/

const gotoExtensionURL = function(ev) {
    const target = ev.currentTarget;
    if ( target.hasAttribute('data-extension-url') === false ) { return; }
    let url = target.getAttribute('data-extension-url');
    if ( url === '' ) { return; }
    if (
        url === 'logger-ui.html#_' &&
        typeof matrixSnapshot.tabId === 'number'
    ) {
        url += '+' + matrixSnapshot.tabId;
    }
    vAPI.messaging.send('popup.js', {
        what: 'gotoExtensionURL',
        url,
        select: true,
        shiftKey: ev.shiftKey,
    });
    dropDownMenuHide();
    vAPI.closePopup();
};

/******************************************************************************/

const dropDownMenuShow = function(button) {
    const menuOverlay = document.getElementById(
        button.getAttribute('data-dropdown-menu')
    );
    const butnRect = button.getBoundingClientRect();
    const viewRect = document.body.getBoundingClientRect();
    const butnNormalLeft = butnRect.left / (viewRect.width - butnRect.width);
    menuOverlay.classList.add('show');
    const menu = menuOverlay.querySelector('.dropdown-menu');
    const menuRect = menu.getBoundingClientRect();
    const menuLeft = butnNormalLeft * (viewRect.width - menuRect.width);
    menu.style.top = butnRect.bottom + 'px';
    if ( menuOverlay.classList.contains('dropdown-menu-centered') === false ) {
        menu.style.left = menuLeft.toFixed(0) + 'px';
    }
};

const dropDownMenuHide = function() {
    uDom('.dropdown-menu-capture').removeClass('show');
};

/******************************************************************************/

const onMatrixSnapshotReady = function(response) {
    if ( response === 'ENOTFOUND' ) {
        uDom.nodeFromId('noTabFound').textContent =
            vAPI.i18n('matrixNoTabFound');
        document.body.classList.add('noTabFound');
        return;
    }

    // Now that tabId and pageURL are set, we can build our menu
    initMenuEnvironment();
    makeMenu();

    // After popup menu is built, check whether there is a non-empty matrix
    if ( matrixSnapshot.url === '' ) {
        uDom('#matHead').remove();
        uDom('#toolbarContainer').remove();

        // https://github.com/gorhill/httpswitchboard/issues/191
        uDom('#noNetTrafficPrompt').text(vAPI.i18n('matrixNoNetTrafficPrompt'));
        uDom('#noNetTrafficPrompt').css('display', '');
    }

    // Create a hash to find out whether the reload button needs to be
    // highlighted.
    // TODO:
};

/******************************************************************************/

const matrixSnapshotPoller = (( ) => {
    let timer;

    const preprocessMatrixSnapshot = function(snapshot) {
        if ( Array.isArray(snapshot.headerIndices) ) {
            snapshot.headerIndices = new Map(snapshot.headerIndices);
        }
        return snapshot;
    };

    const processPollResult = function(response) {
        if ( typeof response !== 'object' ) { return; }
        if (
            response.mtxContentModified === false &&
            response.mtxCountModified === false &&
            response.pMatrixModified === false &&
            response.tMatrixModified === false
        ) {
            return;
        }
        if ( response instanceof Object ) {
            matrixSnapshot = preprocessMatrixSnapshot(response);
        }
        if ( response.mtxContentModified ) {
            makeMenu();
            return;
        }
        if ( response.mtxCountModified ) {
            updateMatrixCounts();
        }
        if (
            response.pMatrixModified ||
            response.tMatrixModified ||
            response.scopeModified
        ) {
            updateMatrixColors();
            updateMatrixBehavior();
            updateMatrixButtons();
        }
    };

    const onPolled = function(response) {
        processPollResult(response);
        pollAsync();
    };

    const pollNow = function() {
        unpollAsync();
        vAPI.messaging.send('popup.js', {
            what: 'matrixSnapshot',
            tabId: matrixSnapshot.tabId,
            scope: matrixSnapshot.scope,
            mtxContentModifiedTime: matrixSnapshot.mtxContentModifiedTime,
            mtxCountModifiedTime: matrixSnapshot.mtxCountModifiedTime,
            mtxDiffCount: matrixSnapshot.diff.length,
            pMatrixModifiedTime: matrixSnapshot.pMatrixModifiedTime,
            tMatrixModifiedTime: matrixSnapshot.tMatrixModifiedTime,
        }).then(response => {
            onPolled(response);
        });
    };

    const pollAsync = function() {
        if ( timer !== undefined ) { return; }
        if ( document.defaultView === null ) { return; }
        //if ( typeof matrixSnapshot.tabId !== 'number' ) { return; }
        timer = vAPI.setTimeout(
            ( ) => {
                timer = undefined;
                pollNow();
            },
            1414
        );
    };

    const unpollAsync = function() {
        if ( timer !== undefined ) {
            clearTimeout(timer);
            timer = undefined;
        }
    };

    vAPI.messaging.send('popup.js', {
        what: 'matrixSnapshot',
        tabId: matrixSnapshot.tabId,
    }).then(response => {
        if ( response instanceof Object ) {
            matrixSnapshot = preprocessMatrixSnapshot(response);
        }
        onMatrixSnapshotReady(response);
        pollAsync();
    });

    return {
        pollNow: pollNow
    };
})();

/******************************************************************************/

// Below is UI stuff which is not key to make the menu, so this can
// be done without having to wait for a tab to be bound to the menu.

// We reuse for all cells the one and only cell hotspots.
uDom('#whitelist').on('click', function() {
        handleWhitelistFilter(uDom(this));
        return false;
    });
uDom('#blacklist').on('click', function() {
        handleBlacklistFilter(uDom(this));
        return false;
    });
uDom('#domainOnly').on('click', function() {
        toggleCollapseState(uDom(this));
        return false;
    });
matrixCellHotspots = uDom('#cellHotspots').detach();
uDom('body')
    .on('mouseenter', '.matCell', mouseenterMatrixCellHandler)
    .on('mouseleave', '.matCell', mouseleaveMatrixCellHandler);
window.addEventListener('uMatrixScopeWidgetChange', scopeChangeHandler);
uDom('#buttonMtxSwitches').on('click', function(ev) {
    dropDownMenuShow(ev.target);
});
uDom('[id^="mtxSwitch_"]').on('click', toggleMatrixSwitch);
uDom('#buttonPersist').on('click', persistMatrix);
uDom('#buttonRevertScope').on('click', revertMatrix);

uDom('#buttonRecipes').on('click', function() {
    recipeManager.show();
});

uDom('#buttonRevertAll').on('click', revertAll);
uDom('[data-extension-url]').on('click', gotoExtensionURL);
uDom('body').on('click', '.dropdown-menu-capture', dropDownMenuHide);

uDom('#matList').on('click', '.g4Meta', function(ev) {
    matrixSnapshot.collapseBlacklistedDomains =
        ev.target.classList.toggle('g4Collapsed');
    setUserSetting(
        'popupCollapseBlacklistedDomains',
        matrixSnapshot.collapseBlacklistedDomains
    );
});

/******************************************************************************/

// <<<<< end of local scope
}
