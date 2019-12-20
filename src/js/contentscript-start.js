/*******************************************************************************

    uMatrix - a browser extension to black/white list requests.
    Copyright (C) 2017-present Raymond Hill

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

(( ) => {

    if ( typeof vAPI !== 'object' ) { return; }

    vAPI.selfWorkerSrcReported = vAPI.selfWorkerSrcReported || false;

    const reGoodWorkerSrc = /(?:child|worker)-src[^;,]+?'none'/;

    const handler = function(ev) {
        if (
            ev.isTrusted !== true ||
            ev.originalPolicy.includes('report-uri about:blank') === false
        ) {
            return false;
        }

        // Firefox and Chromium differs in how they fill the
        // 'effectiveDirective' property.
        if (
            ev.effectiveDirective.startsWith('worker-src') === false &&
            ev.effectiveDirective.startsWith('child-src') === false
        ) {
            return false;
        }

        // Further validate that the policy violation is relevant to uMatrix:
        // the event still could have been fired as a result of a CSP header
        // not injected by uMatrix.
        if ( reGoodWorkerSrc.test(ev.originalPolicy) === false ) {
            return false;
        }

        // We do not want to report internal resources more than once.
        // However, we do want to report external resources each time.
        // TODO: this could eventually lead to duplicated reports for external
        //       resources if another extension uses the same approach as
        //       uMatrix. Think about what could be done to avoid duplicate
        //       reports.
        if ( ev.blockedURI.includes('://') === false ) {
            if ( vAPI.selfWorkerSrcReported ) { return true; }
            vAPI.selfWorkerSrcReported = true;
        }

        vAPI.messaging.send('contentscript.js', {
            what: 'securityPolicyViolation',
            directive: 'worker-src',
            blockedURI: ev.blockedURI,
            documentURI: ev.documentURI,
            blocked: ev.disposition === 'enforce',
        });

        return true;
    };

    document.addEventListener('securitypolicyviolation', ev => {
        if ( !handler(ev) ) { return; }
        ev.stopPropagation();
        ev.preventDefault();
    }, true);

})();
