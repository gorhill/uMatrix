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

_WebRequestStats.prototype.reset = function() {
    this.all = 
    this.doc =
    this.frame =
    this.script =
    this.css =
    this.image =
    this.plugin =
    this.xhr =
    this.other =
    this.cookie = 0;
};

/******************************************************************************/

WebRequestStats.prototype.record = function(type, blocked) {
    // Remember: always test against **false**
    if ( blocked !== false ) {
        this.blocked[type] += 1;
        this.blocked.all += 1;
    } else {
        this.allowed[type] += 1;
        this.allowed.all += 1;
    }
};

/******************************************************************************/

WebRequestStats.prototype.reset = function() {
    this.blocked.reset();
    this.allowed.reset();
};

