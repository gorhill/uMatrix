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

    vAPI.reportedViolations = vAPI.reportedViolations || new Set();

    var cspReportURI = 'about:blank';
    var reportedViolations = vAPI.reportedViolations;

    var handler = function(ev) {
        if (
            ev.isTrusted !== true ||
            ev.originalPolicy.includes(cspReportURI) === false
        ) {
            return false;
        }

        // Firefox and Chromium differs in how they fill the
        // 'effectiveDirective' property. Need to normalize here.
        var directive = ev.effectiveDirective;
        if ( directive.startsWith('script-src') ) {
            directive = 'script-src';
        } else if ( directive.startsWith('worker-src') ) {
            directive = 'worker-src';
        } else if ( directive.startsWith('child-src') ) {
            directive = 'worker-src';
        } else {
            return false;
        }

        var blockedURL;
        try {
            blockedURL = new URL(ev.blockedURI);
        } catch(ex) {
        }
        blockedURL = blockedURL !== undefined ? blockedURL.href || '' : '';

        // Avoid reporting same violations repeatedly.
        var violationKey = (directive + ' ' + blockedURL).trim();
        if ( reportedViolations.has(violationKey) ) {
            return true;
        }
        reportedViolations.add(violationKey);

        vAPI.messaging.send(
            'contentscript.js',
            {
                what: 'securityPolicyViolation',
                directive: directive,
                blockedURI: blockedURL,
                documentURI: ev.documentURI,
                blocked: ev.disposition === 'enforce'
            }
        );

        return true;
    };

    document.addEventListener(
        'securitypolicyviolation',
        function(ev) {
            if ( !handler(ev) ) { return; }
            ev.stopPropagation();
            ev.preventDefault();
        },
        true
    );

})();
