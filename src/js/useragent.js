/*******************************************************************************

    uMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014-2015 Raymond Hill

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

/******************************************************************************/

µMatrix.userAgentSpoofer = (function() {

/******************************************************************************/

var userAgentRandomPicker = function() {
    var µm = µMatrix;
    var userAgents = µm.userSettings.spoofUserAgentWith.split(/[\n\r]+/);
    var i, s, pos;
    while ( userAgents.length ) {
        i = Math.floor(userAgents.length * Math.random());
        s = userAgents[i];
        if ( s.charAt(0) === '#' ) {
            s = '';
        } else {
            s = s.trim();
        }
        if ( s !== '' ) {
            return s;
        }
        userAgents.splice(i, 1);
    }
    return '';
};

/******************************************************************************/

var userAgentSpoofer = function(force) {
    var µm = µMatrix;
    var uaStr = µm.userAgentReplaceStr;
    var obsolete = Date.now();
    if ( !force ) {
        obsolete -= µm.userSettings.spoofUserAgentEvery * 60 * 1000;
    }
    if ( µm.userAgentReplaceStrBirth < obsolete ) {
        uaStr = '';
    }
    if ( uaStr === '' ) {
        µm.userAgentReplaceStr = userAgentRandomPicker();
        µm.userAgentReplaceStrBirth = Date.now();
    }
};

// Prime spoofer
userAgentSpoofer();

/******************************************************************************/

µMatrix.asyncJobs.add('userAgentSwitcher', null, userAgentSpoofer, 120 * 1000, true);

/******************************************************************************/

return {
    shuffle: function() {
        userAgentSpoofer(true);
    }
};

})();

/******************************************************************************/

