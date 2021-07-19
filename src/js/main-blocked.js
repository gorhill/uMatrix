/*******************************************************************************

    uMatrix - a browser extension to block requests.
    Copyright (C) 2015-present Raymond Hill

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

'use strict';

/******************************************************************************/

(function() {

/******************************************************************************/

let details = {};

(function() {
    let matches = /details=([^&]+)/.exec(window.location.search);
    if ( matches === null ) { return; }
    try {
        details = JSON.parse(atob(matches[1]));
    } catch(ex) {
    }
})();

/******************************************************************************/

uDom('.what').text(details.url);
// uDom('#why').text(details.why.slice(3));

/******************************************************************************/

// https://github.com/gorhill/uMatrix/issues/502
//   Code below originally imported from:
//   https://github.com/gorhill/uBlock/blob/master/src/js/document-blocked.js

(function() {
    let reURL = /^https?:\/\//;

    let liFromParam = function(name, value) {
        if ( value === '' ) {
            value = name;
            name = '';
        }
        let li = document.createElement('li');
        let span = document.createElement('span');
        span.textContent = name;
        li.appendChild(span);
        if ( name !== '' && value !== '' ) {
            li.appendChild(document.createTextNode(' = '));
        }
        span = document.createElement('span');
        if ( reURL.test(value) ) {
            let a = document.createElement('a');
            a.href = a.textContent = value;
            span.appendChild(a);
        } else {
            span.textContent = value;
        }
        li.appendChild(span);
        return li;
    };

    let safeDecodeURIComponent = function(s) {
        try {
            s = decodeURIComponent(s);
        } catch (ex) {
        }
        return s;
    };

    let renderParams = function(parentNode, rawURL, depth = 0) {
        let a = document.createElement('a');
        a.href = rawURL;
        if ( a.search.length === 0 ) { return false; }

        let pos = rawURL.indexOf('?');
        let li = liFromParam(
            vAPI.i18n('mainBlockedNoParamsPrompt'),
            rawURL.slice(0, pos)
        );
        parentNode.appendChild(li);

        let params = a.search.slice(1).split('&');
        for ( var i = 0; i < params.length; i++ ) {
            let param = params[i];
            let pos = param.indexOf('=');
            if ( pos === -1 ) {
                pos = param.length;
            }
            let name = safeDecodeURIComponent(param.slice(0, pos));
            let value = safeDecodeURIComponent(param.slice(pos + 1));
            li = liFromParam(name, value);
            if ( depth < 2 && reURL.test(value) ) {
                let ul = document.createElement('ul');
                renderParams(ul, value, depth + 1);
                li.appendChild(ul);
            }
            parentNode.appendChild(li);
        }
        return true;
    };

    let hasParams = renderParams(uDom.nodeFromId('parsed'), details.url);
    if ( hasParams === false ) { return; }

    let theURLNode = document.getElementById('theURL');
    theURLNode.classList.add('hasParams');
    theURLNode.classList.toggle(
        'collapsed',
        vAPI.localStorage.getItem('document-blocked-collapse-url') === 'true'
    );

    let toggleCollapse = function() {
        vAPI.localStorage.setItem(
            'document-blocked-collapse-url',
            theURLNode.classList.toggle('collapsed').toString()
        );
    };

    theURLNode.querySelector('.collapse').addEventListener(
        'click',
        toggleCollapse
    );
    theURLNode.querySelector('.expand').addEventListener(
        'click',
        toggleCollapse
    );
})();

/******************************************************************************/

if ( window.history.length > 1 ) {
    uDom('#back').on('click', function() { window.history.back(); });
    uDom('#bye').css('display', 'none');
} else {
    uDom('#bye').on('click', function() { window.close(); });
    uDom('#back').css('display', 'none');
}

/******************************************************************************/

// See if the target hostname is still blacklisted, and if not, navigate to it.

vAPI.messaging.send('main-blocked.js', {
    what: 'mustBlock',
    scope: details.hn,
    hostname: details.hn,
    type: details.type
}, response => {
    if ( response === false ) {
        window.location.replace(details.url);
    }
});

/******************************************************************************/

})();

/******************************************************************************/
