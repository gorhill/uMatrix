/*******************************************************************************

    µMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014  Raymond Hill

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

/* global punycode, vAPI, uDom */
/* jshint esnext: true, bitwise: false */

/******************************************************************************/
/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/
/******************************************************************************/

// Must be consistent with definitions in matrix.js
var Pale        = 0x00;
var Dark        = 0x80;
var Transparent = 0;
var Red         = 1;
var Green       = 2;
var Gray        = 3;
var DarkRed     = Dark | Red;
var PaleRed     = Pale | Red;
var DarkGreen   = Dark | Green;
var PaleGreen   = Pale | Green;
var DarkGray    = Dark | Gray;
var PaleGray    = Pale | Gray;

var matrixSnapshot = {};
var groupsSnapshot = [];
var allHostnamesSnapshot = 'do not leave this initial string empty';

var matrixCellHotspots = null;

var matrixHeaderPrettyNames = {
    'all': '',
    'cookie': '',
    'css': '',
    'image': '',
    'plugin': '',
    'script': '',
    'xhr': '',
    'frame': '',
    'other': ''
};

var firstPartyLabel = '';
var blacklistedHostnamesLabel = '';

var messager = vAPI.messaging.channel('popup.js');

/******************************************************************************/
/******************************************************************************/

function getUserSetting(setting) {
    return matrixSnapshot.userSettings[setting];
}

function setUserSetting(setting, value) {
    matrixSnapshot.userSettings[setting] = value;
    messager.send({
        what: 'userSettings',
        name: setting,
        value: value
    });
}

/******************************************************************************/

function getUISetting(setting) {
    var r = vAPI.localStorage.getItem(setting);
    if ( typeof r !== 'string' ) {
        return undefined;
    }
    return JSON.parse(r);
}

function setUISetting(setting, value) {
    vAPI.localStorage.setItem(
        setting,
        JSON.stringify(value)
    );
}

/******************************************************************************/

function updateMatrixSnapshot() {
    matrixSnapshotPoller.pollNow();
}

/******************************************************************************/

// For display purpose, create four distinct groups of rows:
// 0th: literal "1st-party" row
// 1st: page domain's related
// 2nd: whitelisted
// 3rd: graylisted
// 4th: blacklisted

function getGroupStats() {

    // Try to not reshuffle groups around while popup is opened if
    // no new hostname added.
    var latestDomainListSnapshot = Object.keys(matrixSnapshot.rows).sort().join();
    if ( latestDomainListSnapshot === allHostnamesSnapshot ) {
        return groupsSnapshot;
    }
    allHostnamesSnapshot = latestDomainListSnapshot;

    // First, group according to whether at least one node in the domain
    // hierarchy is white or blacklisted
    var pageDomain = matrixSnapshot.domain;
    var rows = matrixSnapshot.rows;
    var columnOffsets = matrixSnapshot.headers;
    var anyTypeOffset = columnOffsets['*'];
    var hostname, domain;
    var row, color, count, groupIndex;
    var domainToGroupMap = {};

    // These have hard-coded position which cannot be overriden
    domainToGroupMap['1st-party'] = 0;
    domainToGroupMap[pageDomain] = 1;

    // 1st pass: domain wins if it has an explicit rule or a count
    for ( hostname in rows ) {
        if ( rows.hasOwnProperty(hostname) === false ) {
            continue;
        }
        if ( hostname === '*' || hostname === '1st-party' ) {
            continue;
        }
        domain = rows[hostname].domain;
        if ( domain === pageDomain || hostname !== domain ) {
            continue;
        }
        row = rows[domain];
        color = row.temporary[anyTypeOffset];
        if ( color === DarkGreen ) {
            domainToGroupMap[domain] = 2;
            continue;
        }
        if ( color === DarkRed ) {
            domainToGroupMap[domain] = 4;
            continue;
        }
        count = row.counts[anyTypeOffset];
        if ( count !== 0 ) {
            domainToGroupMap[domain] = 3;
            continue;
        }
    }
    // 2nd pass: green wins
    for ( hostname in rows ) {
        if ( rows.hasOwnProperty(hostname) === false ) {
            continue;
        }
        row = rows[hostname];
        domain = row.domain;
        if ( domainToGroupMap.hasOwnProperty(domain) ) {
            continue;
        }
        color = row.temporary[anyTypeOffset];
        if ( color === DarkGreen ) {
            domainToGroupMap[domain] = 2;
        }
    }
    // 3rd pass: gray with count wins
    for ( hostname in rows ) {
        if ( rows.hasOwnProperty(hostname) === false ) {
            continue;
        }
        row = rows[hostname];
        domain = row.domain;
        if ( domainToGroupMap.hasOwnProperty(domain) ) {
            continue;
        }
        color = row.temporary[anyTypeOffset];
        count = row.counts[anyTypeOffset];
        if ( color !== DarkRed && count !== 0 ) {
            domainToGroupMap[domain] = 3;
        }
    }
    // 4th pass: red wins whatever is left
    for ( hostname in rows ) {
        if ( rows.hasOwnProperty(hostname) === false ) {
            continue;
        }
        row = rows[hostname];
        domain = row.domain;
        if ( domainToGroupMap.hasOwnProperty(domain) ) {
            continue;
        }
        color = row.temporary[anyTypeOffset];
        if ( color === DarkRed ) {
            domainToGroupMap[domain] = 4;
        }
    }
    // 5th pass: gray wins whatever is left
    for ( hostname in rows ) {
        if ( rows.hasOwnProperty(hostname) === false ) {
            continue;
        }
        domain = rows[hostname].domain;
        if ( domainToGroupMap.hasOwnProperty(domain) ) {
            continue;
        }
        domainToGroupMap[domain] = 3;
    }

    // Last pass: put each domain in a group
    var groups = [ {}, {}, {}, {}, {} ];
    var group;
    for ( hostname in rows ) {
        if ( rows.hasOwnProperty(hostname) === false ) {
            continue;
        }
        if ( hostname === '*' ) {
            continue;
        }
        domain = rows[hostname].domain;
        groupIndex = domainToGroupMap[domain];
        group = groups[groupIndex];
        if ( group.hasOwnProperty(domain) === false ) {
            group[domain] = {};
        }
        group[domain][hostname] = true;
    }

    groupsSnapshot = groups;

    return groups;
}

/******************************************************************************/

// helpers

function getTemporaryColor(hostname, type) {
    return matrixSnapshot.rows[hostname].temporary[matrixSnapshot.headers[type]];
}

function getPermanentColor(hostname, type) {
    return matrixSnapshot.rows[hostname].permanent[matrixSnapshot.headers[type]];
}

function getCellClass(hostname, type) {
    return 't' + getTemporaryColor(hostname, type).toString(16) +
          ' p' + getPermanentColor(hostname, type).toString(16);
}

/******************************************************************************/

// This is required for when we update the matrix while it is open:
// the user might have collapsed/expanded one or more domains, and we don't
// want to lose all his hardwork.

function getCollapseState(domain) {
    var states = getUISetting('popupCollapseSpecificDomains');
    if ( typeof states === 'object' && states[domain] !== undefined ) {
        return states[domain];
    }
    return getUISetting('popupCollapseDomains') === true;
}

function toggleCollapseState(elem) {
    if ( elem.ancestors('#matHead.collapsible').length > 0 ) {
        toggleMainCollapseState(elem);
    } else {
        toggleSpecificCollapseState(elem);
    }
    resizePopup();
}

function toggleMainCollapseState(uelem) {
    var matHead = uelem.ancestors('#matHead.collapsible').toggleClass('collapsed');
    var collapsed = matHead.hasClass('collapsed');
    uDom('#matList .matSection.collapsible').toggleClass('collapsed', collapsed);
    setUISetting('popupCollapseDomains', collapsed);

    var specificCollapseStates = getUISetting('popupCollapseSpecificDomains') || {};
    var domains = Object.keys(specificCollapseStates);
    var i = domains.length;
    var domain;
    while ( i-- ) {
        domain = domains[i];
        if ( specificCollapseStates[domain] === collapsed ) {
            delete specificCollapseStates[domain];
        }
    }
    setUISetting('popupCollapseSpecificDomains', specificCollapseStates);
}

function toggleSpecificCollapseState(uelem) {
    // Remember collapse state forever, but only if it is different
    // from main collapse switch.
    var section = uelem.ancestors('.matSection.collapsible').toggleClass('collapsed');
    var domain = section.prop('domain');
    var collapsed = section.hasClass('collapsed');
    var mainCollapseState = getUISetting('popupCollapseDomains') === true;
    var specificCollapseStates = getUISetting('popupCollapseSpecificDomains') || {};
    if ( collapsed !== mainCollapseState ) {
        specificCollapseStates[domain] = collapsed;
        setUISetting('popupCollapseSpecificDomains', specificCollapseStates);
    } else if ( specificCollapseStates[domain] !== undefined ) {
        delete specificCollapseStates[domain];
        setUISetting('popupCollapseSpecificDomains', specificCollapseStates);
    }
}

/******************************************************************************/

// Update count value of matrix cells(s)

function updateMatrixCounts() {
    var matCells = uDom('.matrix .matRow.rw > .matCell');
    var i = matCells.length;
    var matRow, matCell, count, counts;
    var headers = matrixSnapshot.headers;
    var rows = matrixSnapshot.rows;
    while ( i-- ) {
        matCell = matCells.nodeAt(i);
        if ( matCell.hostname === '*' ) {
            continue;
        }
        if ( matCell.reqType === '*' ) {
            continue;
        }
        matRow = matCell.parentNode;
        counts = matRow.classList.contains('meta') ? 'totals' : 'counts';
        count = rows[matCell.hostname][counts][headers[matCell.reqType]];
        if ( count === matCell.count) {
            continue;
        }
        matCell.count = count;
        matCell.textContent = count ? count : '\u00A0';
    }
}

/******************************************************************************/

// Update color of matrix cells(s)
// Color changes when rules change

function updateMatrixColors() {
    var cells = uDom('.matrix .matRow.rw > .matCell').removeClass();
    var i = cells.length;
    var cell;
    while ( i-- ) {
        cell = cells.nodeAt(i);
        cell.className = 'matCell ' + getCellClass(cell.hostname, cell.reqType);
    }
    resizePopup();
}

/******************************************************************************/

// Update behavior of matrix:
// - Whether a section is collapsible or not. It is collapsible if:
//   - It has at least one subdomain AND
//   - There is no explicit rule anywhere in the subdomain cells AND
//   - It is not part of group 3 (blacklisted hostnames)

function updateMatrixBehavior() {
    matrixList = matrixList || uDom('#matList');
    var sections = matrixList.descendants('.matSection');
    var i = sections.length;
    var section, subdomainRows, j, subdomainRow;
    while ( i-- ) {
        section = sections.at(i);
        subdomainRows = section.descendants('.l2:not(.g4)');
        j = subdomainRows.length;
        while ( j-- ) {
            subdomainRow = subdomainRows.at(j);
            subdomainRow.toggleClass('collapsible', subdomainRow.descendants('.t81,.t82').length === 0);
        }
        section.toggleClass('collapsible', subdomainRows.filter('.collapsible').length > 0);
    }
}

/******************************************************************************/

// handle user interaction with filters

function getCellAction(hostname, type, leaning) {
    var temporaryColor = getTemporaryColor(hostname, type);
    var hue = temporaryColor & 0x03;
    // Special case: root toggle only between two states
    if ( type === '*' && hostname === '*' ) {
        return hue === Green ? 'blacklistMatrixCell' : 'whitelistMatrixCell';
    }
    // When explicitly blocked/allowed, can only graylist
    var saturation = temporaryColor & 0x80;
    if ( saturation === Dark ) {
        return 'graylistMatrixCell';
    }
    return leaning === 'whitelisting' ? 'whitelistMatrixCell' : 'blacklistMatrixCell';
}

function handleFilter(button, leaning) {
    // our parent cell knows who we are
    var cell = button.ancestors('div.matCell');
    var type = cell.prop('reqType');
    var desHostname = cell.prop('hostname');
    // https://github.com/gorhill/uMatrix/issues/24
    // No hostname can happen -- like with blacklist meta row
    if ( desHostname === '' ) {
        return;
    }
    var request = {
        what: getCellAction(desHostname, type, leaning),
        srcHostname: matrixSnapshot.scope,
        desHostname: desHostname,
        type: type
    };
    messager.send(request, updateMatrixSnapshot);
}

function handleWhitelistFilter(button) {
    handleFilter(button, 'whitelisting');
}

function handleBlacklistFilter(button) {
    handleFilter(button, 'blacklisting');
}

/******************************************************************************/

var matrixRowPool = [];
var matrixSectionPool = [];
var matrixGroupPool = [];
var matrixRowTemplate = null;
var matrixList = null;

var startMatrixUpdate = function() {
    matrixList =  matrixList || uDom('#matList');
    matrixList.detach();
    var rows = matrixList.descendants('.matRow');
    rows.detach();
    matrixRowPool = matrixRowPool.concat(rows.toArray());
    var sections = matrixList.descendants('.matSection');
    sections.detach();
    matrixSectionPool = matrixSectionPool.concat(sections.toArray());
    var groups = matrixList.descendants('.matGroup');
    groups.detach();
    matrixGroupPool = matrixGroupPool.concat(groups.toArray());
};

var endMatrixUpdate = function() {
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

var createMatrixGroup = function() {
    var group = matrixGroupPool.pop();
    if ( group ) {
        return uDom(group).removeClass().addClass('matGroup');
    }
    return uDom(document.createElement('div')).addClass('matGroup');
};

var createMatrixSection = function() {
    var section = matrixSectionPool.pop();
    if ( section ) {
        return uDom(section).removeClass().addClass('matSection');
    }
    return uDom(document.createElement('div')).addClass('matSection');
};

var createMatrixRow = function() {
    var row = matrixRowPool.pop();
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

function renderMatrixHeaderRow() {
    var matHead = uDom('#matHead.collapsible');
    matHead.toggleClass('collapsed', getUISetting('popupCollapseDomains') === true);
    var cells = matHead.descendants('.matCell');
    cells.at(0)
        .prop('reqType', '*')
        .prop('hostname', '*')
        .addClass(getCellClass('*', '*'));
    cells.at(1)
        .prop('reqType', 'cookie')
        .prop('hostname', '*')
        .addClass(getCellClass('*', 'cookie'));
    cells.at(2)
        .prop('reqType', 'css')
        .prop('hostname', '*')
        .addClass(getCellClass('*', 'css'));
    cells.at(3)
        .prop('reqType', 'image')
        .prop('hostname', '*')
        .addClass(getCellClass('*', 'image'));
    cells.at(4)
        .prop('reqType', 'plugin')
        .prop('hostname', '*')
        .addClass(getCellClass('*', 'plugin'));
    cells.at(5)
        .prop('reqType', 'script')
        .prop('hostname', '*')
        .addClass(getCellClass('*', 'script'));
    cells.at(6)
        .prop('reqType', 'xhr')
        .prop('hostname', '*')
        .addClass(getCellClass('*', 'xhr'));
    cells.at(7)
        .prop('reqType', 'frame')
        .prop('hostname', '*')
        .addClass(getCellClass('*', 'frame'));
    cells.at(8)
        .prop('reqType', 'other')
        .prop('hostname', '*')
        .addClass(getCellClass('*', 'other'));
    uDom('#matHead .matRow').css('display', '');
}

/******************************************************************************/

function renderMatrixCellDomain(cell, domain) {
    var contents = cell.prop('reqType', '*')
        .prop('hostname', domain)
        .addClass(getCellClass(domain, '*'))
        .contents();
    contents.nodeAt(0).textContent = domain === '1st-party' ?
        firstPartyLabel :
        punycode.toUnicode(domain);
    contents.nodeAt(1).textContent = ' ';
}

function renderMatrixCellSubdomain(cell, domain, subomain) {
    var contents = cell.prop('reqType', '*')
        .prop('hostname', subomain)
        .addClass(getCellClass(subomain, '*'))
        .contents();
    contents.nodeAt(0).textContent = punycode.toUnicode(subomain.slice(0, subomain.lastIndexOf(domain)-1)) + '.';
    contents.nodeAt(1).textContent = punycode.toUnicode(domain);
}

function renderMatrixMetaCellDomain(cell, domain) {
    var contents = cell.prop('reqType', '*')
        .prop('hostname', domain)
        .addClass(getCellClass(domain, '*'))
        .contents();
    contents.nodeAt(0).textContent = '\u2217.' + punycode.toUnicode(domain);
    contents.nodeAt(1).textContent = ' ';
}

function renderMatrixCellType(cell, hostname, type, count) {
    cell.prop('reqType', type)
        .prop('hostname', hostname)
        .prop('count', count)
        .addClass(getCellClass(hostname, type));
    if ( count ) {
        cell.text(count);
    } else {
        cell.text('\u00A0');
    }
}

function renderMatrixCellTypes(cells, hostname, countName) {
    var counts = matrixSnapshot.rows[hostname][countName];
    var countIndices = matrixSnapshot.headers;
    renderMatrixCellType(cells.at(1), hostname, 'cookie', counts[countIndices.cookie]);
    renderMatrixCellType(cells.at(2), hostname, 'css', counts[countIndices.css]);
    renderMatrixCellType(cells.at(3), hostname, 'image', counts[countIndices.image]);
    renderMatrixCellType(cells.at(4), hostname, 'plugin', counts[countIndices.plugin]);
    renderMatrixCellType(cells.at(5), hostname, 'script', counts[countIndices.script]);
    renderMatrixCellType(cells.at(6), hostname, 'xhr', counts[countIndices.xhr]);
    renderMatrixCellType(cells.at(7), hostname, 'frame', counts[countIndices.frame]);
    renderMatrixCellType(cells.at(8), hostname, 'other', counts[countIndices.other]);
}

/******************************************************************************/

function makeMatrixRowDomain(domain) {
    var matrixRow = createMatrixRow().addClass('rw');
    var cells = matrixRow.descendants('.matCell');
    renderMatrixCellDomain(cells.at(0), domain);
    renderMatrixCellTypes(cells, domain, 'counts');
    return matrixRow;
}

function makeMatrixRowSubdomain(domain, subdomain) {
    var matrixRow = createMatrixRow().addClass('rw');
    var cells = matrixRow.descendants('.matCell');
    renderMatrixCellSubdomain(cells.at(0), domain, subdomain);
    renderMatrixCellTypes(cells, subdomain, 'counts');
    return matrixRow;
}

function makeMatrixMetaRowDomain(domain) {
    var matrixRow = createMatrixRow().addClass('rw');
    var cells = matrixRow.descendants('.matCell');
    renderMatrixMetaCellDomain(cells.at(0), domain);
    renderMatrixCellTypes(cells, domain, 'totals');
    return matrixRow;
}

/******************************************************************************/

function renderMatrixMetaCellType(cell, count) {
    // https://github.com/gorhill/uMatrix/issues/24
    // Don't forget to reset cell properties
    cell.addClass('t1')
        .prop('reqType', '')
        .prop('hostname', '')
        .prop('count', count);
    if ( count ) {
        cell.text(count);
    } else {
        cell.text('\u00A0');
    }
}

function makeMatrixMetaRow(totals) {
    var typeOffsets = matrixSnapshot.headers;
    var matrixRow = createMatrixRow().at(0).addClass('ro');
    var cells = matrixRow.descendants('.matCell');
    var contents = cells.at(0).addClass('t81').contents();
    cells.at(0).prop('reqType', '*').prop('hostname', '');
    contents.nodeAt(0).textContent = ' ';
    contents.nodeAt(1).textContent = blacklistedHostnamesLabel.replace(
        '{{count}}',
        totals[typeOffsets['*']].toLocaleString()
    );
    renderMatrixMetaCellType(cells.at(1), totals[typeOffsets.cookie]);
    renderMatrixMetaCellType(cells.at(2), totals[typeOffsets.css]);
    renderMatrixMetaCellType(cells.at(3), totals[typeOffsets.image]);
    renderMatrixMetaCellType(cells.at(4), totals[typeOffsets.plugin]);
    renderMatrixMetaCellType(cells.at(5), totals[typeOffsets.script]);
    renderMatrixMetaCellType(cells.at(6), totals[typeOffsets.xhr]);
    renderMatrixMetaCellType(cells.at(7), totals[typeOffsets.frame]);
    renderMatrixMetaCellType(cells.at(8), totals[typeOffsets.other]);
    return matrixRow;
}

/******************************************************************************/

function computeMatrixGroupMetaStats(group) {
    var headers = matrixSnapshot.headers;
    var n = Object.keys(headers).length;
    var totals = new Array(n);
    var i = n;
    while ( i-- ) {
        totals[i] = 0;
    }
    var rows = matrixSnapshot.rows, row;
    for ( var hostname in rows ) {
        if ( rows.hasOwnProperty(hostname) === false ) {
            continue;
        }
        row = rows[hostname];
        if ( group.hasOwnProperty(row.domain) === false ) {
            continue;
        }
        if ( row.counts[headers['*']] === 0 ) {
            continue;
        }
        totals[0] += 1;
        for ( i = 1; i < n; i++ ) {
            totals[i] += row.counts[i];
        }
    }
    return totals;
}

/******************************************************************************/

// Compare hostname helper, to order hostname in a logical manner:
// top-most < bottom-most, take into account whether IP address or
// named hostname

function hostnameCompare(a,b) {
    // Normalize: most significant parts first
    if ( !a.match(/^\d+(\.\d+){1,3}$/) ) {
        var aa = a.split('.');
        a = aa.slice(-2).concat(aa.slice(0,-2).reverse()).join('.');
    }
    if ( !b.match(/^\d+(\.\d+){1,3}$/) ) {
        var bb = b.split('.');
        b = bb.slice(-2).concat(bb.slice(0,-2).reverse()).join('.');
    }
    return a.localeCompare(b);
}

/******************************************************************************/

function makeMatrixGroup0SectionDomain() {
    return makeMatrixRowDomain('1st-party').addClass('g0 l1');
}

function makeMatrixGroup0Section() {
    var domainDiv = createMatrixSection().prop('domain', '1st-party');
    makeMatrixGroup0SectionDomain().appendTo(domainDiv);
    return domainDiv;
}

function makeMatrixGroup0() {
    // Show literal "1st-party" row only if there is 
    // at least one 1st-party hostname
    if ( Object.keys(groupsSnapshot[1]).length === 0 ) {
        return;
    }
    var groupDiv = createMatrixGroup().addClass('g0');
    makeMatrixGroup0Section().appendTo(groupDiv);
    groupDiv.appendTo(matrixList);
}

/******************************************************************************/

function makeMatrixGroup1SectionDomain(domain) {
    return makeMatrixRowDomain(domain)
        .addClass('g1 l1');
}

function makeMatrixGroup1SectionSubomain(domain, subdomain) {
    return makeMatrixRowSubdomain(domain, subdomain)
        .addClass('g1 l2');
}

function makeMatrixGroup1SectionMetaDomain(domain) {
    return makeMatrixMetaRowDomain(domain).addClass('g1 l1 meta');
}

function makeMatrixGroup1Section(hostnames) {
    var domain = hostnames[0];
    var domainDiv = createMatrixSection()
        .toggleClass('collapsed', getCollapseState(domain))
        .prop('domain', domain);
    if ( hostnames.length > 1 ) {
        makeMatrixGroup1SectionMetaDomain(domain)
            .appendTo(domainDiv);
    }
    makeMatrixGroup1SectionDomain(domain)
        .appendTo(domainDiv);
    for ( var i = 1; i < hostnames.length; i++ ) {
        makeMatrixGroup1SectionSubomain(domain, hostnames[i])
            .appendTo(domainDiv);
    }
    return domainDiv;
}

function makeMatrixGroup1(group) {
    var domains = Object.keys(group).sort(hostnameCompare);
    if ( domains.length ) {
        var groupDiv = createMatrixGroup().addClass('g1');
        makeMatrixGroup1Section(Object.keys(group[domains[0]]).sort(hostnameCompare))
            .appendTo(groupDiv);
        for ( var i = 1; i < domains.length; i++ ) {
            makeMatrixGroup1Section(Object.keys(group[domains[i]]).sort(hostnameCompare))
                .appendTo(groupDiv);
        }
        groupDiv.appendTo(matrixList);
    }
}

/******************************************************************************/

function makeMatrixGroup2SectionDomain(domain) {
    return makeMatrixRowDomain(domain)
        .addClass('g2 l1');
}

function makeMatrixGroup2SectionSubomain(domain, subdomain) {
    return makeMatrixRowSubdomain(domain, subdomain)
        .addClass('g2 l2');
}

function makeMatrixGroup2SectionMetaDomain(domain) {
    return makeMatrixMetaRowDomain(domain).addClass('g2 l1 meta');
}

function makeMatrixGroup2Section(hostnames) {
    var domain = hostnames[0];
    var domainDiv = createMatrixSection()
        .toggleClass('collapsed', getCollapseState(domain))
        .prop('domain', domain);
    if ( hostnames.length > 1 ) {
        makeMatrixGroup2SectionMetaDomain(domain).appendTo(domainDiv);
    }
    makeMatrixGroup2SectionDomain(domain)
        .appendTo(domainDiv);
    for ( var i = 1; i < hostnames.length; i++ ) {
        makeMatrixGroup2SectionSubomain(domain, hostnames[i])
            .appendTo(domainDiv);
    }
    return domainDiv;
}

function makeMatrixGroup2(group) {
    var domains = Object.keys(group).sort(hostnameCompare);
    if ( domains.length) {
        var groupDiv = createMatrixGroup()
            .addClass('g2');
        makeMatrixGroup2Section(Object.keys(group[domains[0]]).sort(hostnameCompare))
            .appendTo(groupDiv);
        for ( var i = 1; i < domains.length; i++ ) {
            makeMatrixGroup2Section(Object.keys(group[domains[i]]).sort(hostnameCompare))
                .appendTo(groupDiv);
        }
        groupDiv.appendTo(matrixList);
    }
}

/******************************************************************************/

function makeMatrixGroup3SectionDomain(domain) {
    return makeMatrixRowDomain(domain)
        .addClass('g3 l1');
}

function makeMatrixGroup3SectionSubomain(domain, subdomain) {
    return makeMatrixRowSubdomain(domain, subdomain)
        .addClass('g3 l2');
}

function makeMatrixGroup3SectionMetaDomain(domain) {
    return makeMatrixMetaRowDomain(domain).addClass('g3 l1 meta');
}

function makeMatrixGroup3Section(hostnames) {
    var domain = hostnames[0];
    var domainDiv = createMatrixSection()
        .toggleClass('collapsed', getCollapseState(domain))
        .prop('domain', domain);
    if ( hostnames.length > 1 ) {
        makeMatrixGroup3SectionMetaDomain(domain).appendTo(domainDiv);
    }
    makeMatrixGroup3SectionDomain(domain)
        .appendTo(domainDiv);
    for ( var i = 1; i < hostnames.length; i++ ) {
        makeMatrixGroup3SectionSubomain(domain, hostnames[i])
            .appendTo(domainDiv);
    }
    return domainDiv;
}

function makeMatrixGroup3(group) {
    var domains = Object.keys(group).sort(hostnameCompare);
    if ( domains.length) {
        var groupDiv = createMatrixGroup()
            .addClass('g3');
        makeMatrixGroup3Section(Object.keys(group[domains[0]]).sort(hostnameCompare))
            .appendTo(groupDiv);
        for ( var i = 1; i < domains.length; i++ ) {
            makeMatrixGroup3Section(Object.keys(group[domains[i]]).sort(hostnameCompare))
                .appendTo(groupDiv);
        }
        groupDiv.appendTo(matrixList);
    }
}

/******************************************************************************/

function makeMatrixGroup4SectionDomain(domain) {
    return makeMatrixRowDomain(domain)
        .addClass('g4 l1');
}

function makeMatrixGroup4SectionSubomain(domain, subdomain) {
    return makeMatrixRowSubdomain(domain, subdomain)
        .addClass('g4 l2');
}

function makeMatrixGroup4Section(hostnames) {
    var domain = hostnames[0];
    var domainDiv = createMatrixSection()
        .prop('domain', domain);
    makeMatrixGroup4SectionDomain(domain)
        .appendTo(domainDiv);
    for ( var i = 1; i < hostnames.length; i++ ) {
        makeMatrixGroup4SectionSubomain(domain, hostnames[i])
            .appendTo(domainDiv);
    }
    return domainDiv;
}

function makeMatrixGroup4(group) {
    var domains = Object.keys(group).sort(hostnameCompare);
    if ( domains.length === 0 ) {
        return;
    }
    var groupDiv = createMatrixGroup().addClass('g4');
    createMatrixSection()
        .addClass('g4Meta')
        .toggleClass('g4Collapsed', !!getUISetting('popupHideBlacklisted'))
        .appendTo(groupDiv);
    makeMatrixMetaRow(computeMatrixGroupMetaStats(group), 'g4')
        .appendTo(groupDiv);
    makeMatrixGroup4Section(Object.keys(group[domains[0]]).sort(hostnameCompare))
        .appendTo(groupDiv);
    for ( var i = 1; i < domains.length; i++ ) {
        makeMatrixGroup4Section(Object.keys(group[domains[i]]).sort(hostnameCompare))
            .appendTo(groupDiv);
    }
    groupDiv.appendTo(matrixList);
}

/******************************************************************************/

var makeMenu = function() {
    var groupStats = getGroupStats();

    if ( Object.keys(groupStats).length === 0 ) {
        return;
    }

    // https://github.com/gorhill/httpswitchboard/issues/31
    if ( matrixCellHotspots ) {
        matrixCellHotspots.detach();
    }

    renderMatrixHeaderRow();

    // Manually adjust the position of the main matrix according to the height
    // of the toolbar/matrix header.
    document.querySelector('.paneContent').style.setProperty(
        'padding-top',
        document.querySelector('.paneHead').clientHeight + 'px'
    );

    startMatrixUpdate();
    makeMatrixGroup0(groupStats[0]);
    makeMatrixGroup1(groupStats[1]);
    makeMatrixGroup2(groupStats[2]);
    makeMatrixGroup3(groupStats[3]);
    makeMatrixGroup4(groupStats[4]);
    endMatrixUpdate();

    initScopeCell();
    updateMatrixButtons();
    resizePopup();
};

/******************************************************************************/

// Do all the stuff that needs to be done before building menu et al.

function initMenuEnvironment() {
    uDom('body').css('font-size', getUserSetting('displayTextSize'));
    uDom('body').toggleClass('colorblind', getUserSetting('colorBlindFriendly') === true);
    uDom('#version').text(matrixSnapshot.appVersion || '');

    var prettyNames = matrixHeaderPrettyNames;
    var keys = Object.keys(prettyNames);
    var i = keys.length;
    var cell, key, text;
    while ( i-- ) {
        key = keys[i];
        cell = uDom('#matHead .matCell[data-req-type="'+ key +'"]');
        text = vAPI.i18n(key + 'PrettyName');
        cell.text(text);
        prettyNames[key] = text;
    }

    firstPartyLabel = uDom('[data-i18n="matrix1stPartyLabel"]').text();
    blacklistedHostnamesLabel = uDom('[data-i18n="matrixBlacklistedHostnames"]').text();
}

/******************************************************************************/

// Create page scopes for the web page

function selectGlobalScope() {
    setUserSetting('popupScopeLevel', '*');
    matrixSnapshot.tMatrixModifiedTime = undefined;
    updateMatrixSnapshot();
    dropDownMenuHide();
}

function selectDomainScope() {
    setUserSetting('popupScopeLevel', 'domain');
    matrixSnapshot.tMatrixModifiedTime = undefined;
    updateMatrixSnapshot();
    dropDownMenuHide();
}

function selectSiteScope() {
    setUserSetting('popupScopeLevel', 'site');
    matrixSnapshot.tMatrixModifiedTime = undefined;
    updateMatrixSnapshot();
    dropDownMenuHide();
}

function getClassFromScope() {
    if ( matrixSnapshot.scope === '*' ) {
        return 'tScopeGlobal';
    }
    if ( matrixSnapshot.scope === matrixSnapshot.domain ) {
        return 'tScopeDomain';
    }
    return 'tScopeSite';
}

function initScopeCell() {
    // It's possible there is no page URL at this point: some pages cannot
    // be filtered by µMatrix.
    if ( matrixSnapshot.url === '' ) {
        return;
    }
    // Fill in the scope menu entries
    if ( matrixSnapshot.hostname === matrixSnapshot.domain ) {
        uDom('#scopeKeySite').css('display', 'none');
    } else {
        uDom('#scopeKeySite').text(punycode.toUnicode(matrixSnapshot.hostname));
    }
    uDom('#scopeKeyDomain').text(punycode.toUnicode(matrixSnapshot.domain));
    updateScopeCell();
}

function updateScopeCell() {
    uDom('body')
        .removeClass('tScopeGlobal tScopeDomain tScopeSite')
        .addClass(getClassFromScope());
    uDom('#scopeCell').text(
        punycode.toUnicode(matrixSnapshot.scope).replace('*', '\u2217')
    );
}

/******************************************************************************/

function updateMatrixSwitches() {
    var switches = matrixSnapshot.tSwitches;
    for ( var switchName in switches ) {
        if ( switches.hasOwnProperty(switchName) === false ) {
            continue;
        }
        uDom('#mtxSwitch_' + switchName).toggleClass('switchTrue', switches[switchName]);
        
    }
    var count = matrixSnapshot.blockedCount;
    var button = uDom('#mtxSwitch_matrix-off');
    button.descendants('span.badge').text(count.toLocaleString());
    button.attr('data-tip', button.attr('data-tip').replace('{{count}}', count));
    uDom('body').toggleClass('powerOff', switches['matrix-off']);
}

function updateMatrixSwitchButton() {
    var switchesActive = uDom('#mtxSwitch_ua-spoof').hasClass('switchTrue') ||
            uDom('#mtxSwitch_referrer-spoof').hasClass('switchTrue') ||
            uDom('#mtxSwitch_https-strict').hasClass('switchTrue');
    uDom('#buttonMtxSwitches').toggleClass('disabled', !switchesActive);
}

function toggleMatrixSwitch(ev) {
    var elem = ev.currentTarget;
    var pos = elem.id.indexOf('_');
    if ( pos === -1 ) {
        return;
    }
    var switchName = elem.id.slice(pos + 1);
    var request = {
        what: 'toggleMatrixSwitch',
        switchName: switchName,
        srcHostname: matrixSnapshot.scope
    };
    messager.send(request, updateMatrixSnapshot);
}

/******************************************************************************/

function updatePersistButton() {
    var diffCount = matrixSnapshot.diff.length;
    var button = uDom('#buttonPersist');
    button.contents()
          .filter(function(){return this.nodeType===3;})
          .first()
          .text(diffCount > 0 ? '\uf13e' : '\uf023');
    button.descendants('span.badge').text(diffCount > 0 ? diffCount : '');
    var disabled = diffCount === 0;
    button.toggleClass('disabled', disabled);
    uDom('#buttonRevertScope').toggleClass('disabled', disabled);
}

/******************************************************************************/

function persistMatrix() {
    var request = {
        what: 'applyDiffToPermanentMatrix',
        diff: matrixSnapshot.diff
    };
    messager.send(request, updateMatrixSnapshot);
}

/******************************************************************************/

// rhill 2014-03-12: revert completely ALL changes related to the
// current page, including scopes.

function revertMatrix() {
    var request = {
        what: 'applyDiffToTemporaryMatrix',
        diff: matrixSnapshot.diff
    };
    messager.send(request, updateMatrixSnapshot);
}

/******************************************************************************/

// Buttons which are affected by any changes in the matrix

function updateMatrixButtons() {
    updateScopeCell();
    updateMatrixSwitches();
    updateMatrixSwitchButton();
    updatePersistButton();
}

/******************************************************************************/

function revertAll() {
    var request = {
        what: 'revertTemporaryMatrix'
    };
    messager.send(request, updateMatrixSnapshot);
    dropDownMenuHide();
}

/******************************************************************************/

function buttonReloadHandler() {
    messager.send({
        what: 'forceReloadTab',
        tabId: matrixSnapshot.tabId
    });
}

/******************************************************************************/

function mouseenterMatrixCellHandler(ev) {
    matrixCellHotspots.appendTo(ev.target);
}

function mouseleaveMatrixCellHandler() {
    matrixCellHotspots.detach();
}

/******************************************************************************/

function gotoExtensionURL(ev) {
    var url = uDom(ev.currentTarget).attr('data-extension-url');
    if ( url ) {
        messager.send({ what: 'gotoExtensionURL', url: url });
    }
    dropDownMenuHide();
    vAPI.closePopup();
}

/******************************************************************************/

function dropDownMenuShow(ev) {
    var button = ev.target;
    var menu = button.nextElementSibling;
    var butnRect = button.getBoundingClientRect();
    var viewRect = document.body.getBoundingClientRect();
    var butnNormalLeft = butnRect.left / (viewRect.width - butnRect.width);
    menu.classList.add('show');
    var menuRect = menu.getBoundingClientRect();
    var menuLeft = butnNormalLeft * (viewRect.width - menuRect.width);
    menu.style.left = menuLeft.toFixed(0) + 'px';
}

function dropDownMenuHide() {
    uDom('.dropdown-menu').removeClass('show');
}

/******************************************************************************/

var onMatrixSnapshotReady = function(response) {
    // Now that tabId and pageURL are set, we can build our menu
    initMenuEnvironment();
    makeMenu();

    // After popup menu is built, check whether there is a non-empty matrix
    if ( matrixSnapshot.url === '' ) {
        uDom('#matHead').remove();
        uDom('#toolbarLeft').remove();

        // https://github.com/gorhill/httpswitchboard/issues/191
        uDom('#noNetTrafficPrompt').text(vAPI.i18n('matrixNoNetTrafficPrompt'));
        uDom('#noNetTrafficPrompt').css('display', '');
    }

    // Create a hash to find out whether the reload button needs to be
    // highlighted.
    // TODO:
};

/******************************************************************************/

var resizePopup = function() {
    document.body.setAttribute('data-resize-popup', 'true');
};

/******************************************************************************/

var matrixSnapshotPoller = (function() {
    var timer = null;

    var processPollResult = function(response) {
        if ( typeof response !== 'object' ) {
            return;
        }
        if (
            response.mtxContentModified === false &&
            response.mtxCountModified === false &&
            response.pMatrixModified === false &&
            response.tMatrixModified === false
        ) {
            return;
        }
        matrixSnapshot = response;
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

    var onPolled = function(response) {
        processPollResult(response);
        pollAsync();
    };

    var pollNow = function() {
        unpollAsync();
        messager.send({
            what: 'matrixSnapshot',
            tabId: matrixSnapshot.tabId,
            mtxContentModifiedTime: matrixSnapshot.mtxContentModifiedTime,
            mtxCountModifiedTime: matrixSnapshot.mtxCountModifiedTime,
            mtxDiffCount: matrixSnapshot.diff.length,
            pMatrixModifiedTime: matrixSnapshot.pMatrixModifiedTime,
            tMatrixModifiedTime: matrixSnapshot.tMatrixModifiedTime,
        }, onPolled);
    };

    var poll = function() {
        timer = null;
        pollNow();
    };

    var pollAsync = function() {
        if ( timer !== null ) {
            return;
        }
        if ( document.defaultView === null ) {
            return;
        }
        timer = vAPI.setTimeout(poll, 1414);
    };

    var unpollAsync = function() {
        if ( timer !== null ) {
            clearTimeout(timer);
            timer = null;
        }
    };

    (function() {
        var tabId = matrixSnapshot.tabId;

        // If no tab id yet, see if there is one specified in our URL
        if ( tabId === undefined ) {
            var matches = window.location.search.match(/(?:\?|&)tabId=([^&]+)/);
            if ( matches !== null ) {
                tabId = matches[1];
                // No need for logger button when embedded in logger
                uDom('[data-extension-url="logger-ui.html"]').remove();
            }
        }

        var snapshotFetched = function(response) {
            if ( typeof response === 'object' ) {
                matrixSnapshot = response;
            }
            onMatrixSnapshotReady();
            pollAsync();
        };

        messager.send({
            what: 'matrixSnapshot',
            tabId: tabId
        }, snapshotFetched);
    })();

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
uDom('#scopeKeyGlobal').on('click', selectGlobalScope);
uDom('#scopeKeyDomain').on('click', selectDomainScope);
uDom('#scopeKeySite').on('click', selectSiteScope);
uDom('[id^="mtxSwitch_"]').on('click', toggleMatrixSwitch);
uDom('#buttonPersist').on('click', persistMatrix);
uDom('#buttonRevertScope').on('click', revertMatrix);

uDom('#buttonRevertAll').on('click', revertAll);
uDom('#buttonReload').on('click', buttonReloadHandler);
uDom('.extensionURL').on('click', gotoExtensionURL);

uDom('body').on('click', '.dropdown-menu-button', dropDownMenuShow);
uDom('body').on('click', '.dropdown-menu-capture', dropDownMenuHide);

uDom('#matList').on('click', '.g4Meta', function() {
    var collapsed = uDom(this)
        .toggleClass('g4Collapsed')
        .hasClass('g4Collapsed');
    setUISetting('popupHideBlacklisted', collapsed);
    resizePopup();
});

/******************************************************************************/

})();
