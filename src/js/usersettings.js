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

/******************************************************************************/

µMatrix.changeUserSettings = function(name, value) {
    if ( typeof name !== 'string' || name === '' ) {
        return;
    }

    // Do not allow an unknown user setting to be created
    if ( this.userSettings[name] === undefined ) {
        return;
    }

    if ( value === undefined ) {
        return this.userSettings[name];
    }

    // Pre-change
    switch ( name ) {
    
    case 'maxLoggedRequests':
        value = Math.max(Math.min(value, 500), 0); 
        break;

    default:        
        break;
    }

    // Change
    this.userSettings[name] = value;

    // Post-change
    switch ( name ) {
    
    // Need to visit each pageStats object to resize ring buffer
    case 'maxLoggedRequests':
        var pageStats = this.pageStats;
        for ( var pageUrl in pageStats ) {
            if ( pageStats.hasOwnProperty(pageUrl) ) {
                pageStats[pageUrl].requests.resizeLogBuffer(value);
            }
        }
        break;

    // https://github.com/gorhill/httpswitchboard/issues/344
    case 'spoofUserAgentWith':
        this.userAgentSpoofer.shuffle();
        break;

    default:        
        break;
    }

    this.saveUserSettings();
};
