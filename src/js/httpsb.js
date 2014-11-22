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

/* global chrome, µMatrix */

/******************************************************************************/

(function() {
    var µm = µMatrix;
    µm.pMatrix = new µm.Matrix();
    µm.pMatrix.setSwitch('matrix-off', 'localhost', 1);
    µm.pMatrix.setSwitch('matrix-off', 'chrome-extension-scheme', 1);
    µm.pMatrix.setSwitch('matrix-off', 'chrome-scheme', 1);
    µm.pMatrix.setSwitch('matrix-off', µm.behindTheSceneScope, 1);
    µm.pMatrix.setSwitch('matrix-off', 'opera-scheme', 1);
    µm.pMatrix.setCell('*', '*', '*', µm.Matrix.Red);
    µm.pMatrix.setCell('*', '*', 'css', µm.Matrix.Green);
    µm.pMatrix.setCell('*', '*', 'image', µm.Matrix.Green);
    µm.pMatrix.setCell('*', '*', 'frame', µm.Matrix.Red);
    µm.pMatrix.setCell('*', '1st-party', '*', µm.Matrix.Green);
    µm.pMatrix.setCell('*', '1st-party', 'frame', µm.Matrix.Green);

    µm.tMatrix = new µm.Matrix();
    µm.tMatrix.assign(µm.pMatrix);
})();

/******************************************************************************/

µMatrix.hostnameFromURL = function(url) {
    var hn = this.URI.hostnameFromURI(url);
    return hn === '' ? '*' : hn;
};

µMatrix.scopeFromURL = µMatrix.hostnameFromURL;

/******************************************************************************/

µMatrix.evaluateURL = function(srcURL, desHostname, type) {
    var srcHostname = this.URI.hostnameFromURI(srcURL);
    return this.tMatrix.evaluateCellZXY(srcHostname, desHostname, type);
};


/******************************************************************************/

µMatrix.transposeType = function(type, path) {
    if ( type !== 'other' ) {
        return type;
    }
    var pos = path.lastIndexOf('.');
    if ( pos === -1 ) {
        return 'other';
    }
    var ext = path.slice(pos) + '.';
    if ( '.css.eot.ttf.otf.svg.woff.woff2.'.indexOf(ext) !== -1 ) {
        return 'css';
    }
    if ( '.ico.png.gif.jpg.jpeg.bmp.'.indexOf(ext) !== -1 ) {
        return 'image';
    }
    return type;
};

/******************************************************************************/

// Whitelist something

µMatrix.whitelistTemporarily = function(srcHostname, desHostname, type) {
    this.tMatrix.whitelistCell(srcHostname, desHostname, type);
};

µMatrix.whitelistPermanently = function(srcHostname, desHostname, type) {
    if ( this.pMatrix.whitelistCell(srcHostname, desHostname, type) ) {
        this.saveMatrix();
    }
};

/******************************************************************************/

// Auto-whitelisting the `all` cell is a serious action, hence this will be
// done only from within a scope.

µMatrix.autoWhitelistAllTemporarily = function(pageURL) {
    var srcHostname = this.URI.hostnameFromURI(pageURL);
    if ( this.mustBlock(srcHostname, '*', '*') === false ) {
        return false;
    }
    this.tMatrix.whitelistCell(srcHostname, '*', '*');
    return true;
};

/******************************************************************************/

// Blacklist something

µMatrix.blacklistTemporarily = function(srcHostname, desHostname, type) {
    this.tMatrix.blacklistCell(srcHostname, desHostname, type);
};

µMatrix.blacklistPermanently = function(srcHostname, desHostname, type) {
    if ( this.pMatrix.blacklist(srcHostname, desHostname, type) ) {
        this.saveMatrix();
    }
};

/******************************************************************************/

// Remove something from both black and white lists.

µMatrix.graylistTemporarily = function(srcHostname, desHostname, type) {
    this.tMatrix.graylistCell(srcHostname, desHostname, type);
};

µMatrix.graylistPermanently = function(srcHostname, desHostname, type) {
    if ( this.pMatrix.graylistCell(srcHostname, desHostname, type) ) {
        this.saveMatrix();
    }
};

/******************************************************************************/

// TODO: Should type be transposed by the caller or in place here? Not an
// issue at this point but to keep in mind as this function is called
// more and more from different places.

µMatrix.filterRequest = function(fromURL, type, toURL) {
    // Block request?
    var srcHostname = this.hostnameFromURL(fromURL);
    var desHostname = this.hostnameFromURL(toURL);

    // If no valid hostname, use the hostname of the source.
    // For example, this case can happen with data URI.
    if ( desHostname === '' ) {
        desHostname = srcHostname;
    }

    // Blocked by matrix filtering?
    if ( this.mustBlock(srcHostname, desHostname, type) ) {
        return true;
    }

    // Cookies are not really requests, but are conveniently treated
    // as such from matrix filtering point of view only.
    if ( type === 'cookie' ) {
        return false;
    }

    return false;
};

/******************************************************************************/

µMatrix.mustBlock = function(srcHostname, desHostname, type) {
    return this.tMatrix.mustBlock(srcHostname, desHostname, type);
};

µMatrix.mustAllow = function(srcHostname, desHostname, type) {
    return this.mustBlock(srcHostname, desHostname, type) === false;
};

/******************************************************************************/

// Commit temporary permissions.

µMatrix.commitPermissions = function(persist) {
    this.pMatrix.assign(this.tMatrix);
    if ( persist ) {
        this.saveMatrix();
    }
};

/******************************************************************************/

// Reset all rules to their default state.

µMatrix.revertAllRules = function() {
    this.tMatrix.assign(this.pMatrix);
};

/******************************************************************************/

µMatrix.turnOff = function() {
    // rhill 2013-12-07:
    // Relinquish control over javascript execution to the user.
    //   https://github.com/gorhill/httpswitchboard/issues/74
    chrome.contentSettings.javascript.clear({});
};

µMatrix.turnOn = function() {
    chrome.contentSettings.javascript.clear({});

    // rhill 2013-12-07:
    // Tell Chromium to allow all javascript: µMatrix will control whether
    // javascript execute through `Content-Policy-Directive` and webRequest.
    //   https://github.com/gorhill/httpswitchboard/issues/74
    chrome.contentSettings.javascript.set({
        primaryPattern: 'https://*/*',
        setting: 'allow'
    });
    chrome.contentSettings.javascript.set({
        primaryPattern: 'http://*/*',
        setting: 'allow'
    });
};

/******************************************************************************/

µMatrix.formatCount = function(count) {
    if ( typeof count !== 'number' ) {
        return '';
    }
    var s = count.toFixed(0);
    if ( count >= 1000 ) {
        if ( count < 10000 ) {
            s = '>' + s.slice(0,1) + 'K';
        } else if ( count < 100000 ) {
            s = s.slice(0,2) + 'K';
        } else if ( count < 1000000 ) {
            s = s.slice(0,3) + 'K';
        } else if ( count < 10000000 ) {
            s = s.slice(0,1) + 'M';
        } else {
            s = s.slice(0,-6) + 'M';
        }
    }
    return s;
};

