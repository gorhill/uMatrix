/*******************************************************************************

    uMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2017 Raymond Hill

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

'use strict';

/******************************************************************************/
/******************************************************************************/

// Injected into content pages

(function() {

    if ( typeof vAPI !== 'object' ) { return; }

    window.addEventListener('securitypolicyviolation', function(ev) {
        vAPI.messaging.send(
            'contentscript.js',
            {
                what: 'securityPolicyViolation',
                policy: ev.originalPolicy,
                blockedURI: ev.blockedURI,
                documentURI: ev.documentURI
            }
        );
    });

})();
