/*******************************************************************************

    µMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014 Raymond Hill

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

// This will inserted as a module in the µMatrix object.

µMatrix.utils = (function() {

/******************************************************************************/

var gotoURL = function(details) {
    vAPI.tabs.open(details);
};

/******************************************************************************/

var gotoExtensionURL = function(url) {
    vAPI.tabs.open({
        url: url,
        index: -1,
        select: true
    });
};

/******************************************************************************/

return {
    gotoURL: gotoURL,
    gotoExtensionURL: gotoExtensionURL
};

/******************************************************************************/

})();

/******************************************************************************/
