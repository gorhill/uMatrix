/*******************************************************************************

    µMatrix - a browser extension to block requests.
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

    Home: https://github.com/gorhill/uBlock
*/

/* global uDom */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var details = {};

(function() {
    var matches = /details=([^&]+)/.exec(window.location.search);
    if ( matches === null ) {
        return;
    }
    details = JSON.parse(atob(matches[1]));
})();

/******************************************************************************/

uDom('.what').text(details.url);
uDom('#why').text(details.why.slice(3));

if ( window.history.length > 1 ) {
    uDom('#back').on('click', function() { window.history.back(); });
    uDom('#bye').css('display', 'none');
} else {
    uDom('#bye').on('click', function() { window.close(); });
    uDom('#back').css('display', 'none');
}

/******************************************************************************/

// See if the target hostname is still blacklisted, and if not, navigate to it.

var messager = vAPI.messaging.channel('main-blocked.js');

messager.send({
    what: 'mustBlock',
    scope: details.hn,
    hostname: details.hn,
    type: 'doc'
}, function(response) {
    if ( response === false ) {
        window.location.replace(details.url);
    }
});

/******************************************************************************/

})();

/******************************************************************************/
