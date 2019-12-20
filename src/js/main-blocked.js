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

{
// >>>>> start of local scope

/******************************************************************************/

let details = {};

(( ) => {
    const matches = /details=([^&]+)/.exec(window.location.search);
    if ( matches === null ) { return; }
    try {
        details = JSON.parse(decodeURIComponent(matches[1]));
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

(( ) => {
    const reURL = /^https?:\/\//;

    const liFromParam = function(name, value) {
        if ( value === '' ) {
            value = name;
            name = '';
        }
        const li = document.createElement('li');
        let span = document.createElement('span');
        span.textContent = name;
        li.appendChild(span);
        if ( name !== '' && value !== '' ) {
            li.appendChild(document.createTextNode(' = '));
        }
        span = document.createElement('span');
        if ( reURL.test(value) ) {
            const a = document.createElement('a');
            a.href = a.textContent = value;
            span.appendChild(a);
        } else {
            span.textContent = value;
        }
        li.appendChild(span);
        return li;
    };

    const safeDecodeURIComponent = function(s) {
        try {
            s = decodeURIComponent(s);
        } catch (ex) {
        }
        return s;
    };

    const renderParams = function(parentNode, rawURL) {
        const a = document.createElement('a');
        a.href = rawURL;
        if ( a.search.length === 0 ) { return false; }

        const pos = rawURL.indexOf('?');
        const li = liFromParam(
            vAPI.i18n('mainBlockedNoParamsPrompt'),
            rawURL.slice(0, pos)
        );
        parentNode.appendChild(li);

        const params = a.search.slice(1).split('&');
        for ( let i = 0; i < params.length; i++ ) {
            const param = params[i];
            let pos = param.indexOf('=');
            if ( pos === -1 ) {
                pos = param.length;
            }
            const name = safeDecodeURIComponent(param.slice(0, pos));
            const value = safeDecodeURIComponent(param.slice(pos + 1));
            const li = liFromParam(name, value);
            if ( reURL.test(value) ) {
                const ul = document.createElement('ul');
                renderParams(ul, value);
                li.appendChild(ul);
            }
            parentNode.appendChild(li);
        }
        return true;
    };

    const hasParams = renderParams(uDom.nodeFromId('parsed'), details.url);
    if ( hasParams === false ) { return; }

    const theURLNode = document.getElementById('theURL');
    theURLNode.classList.add('hasParams');
    theURLNode.classList.toggle(
        'collapsed',
        vAPI.localStorage.getItem('document-blocked-collapse-url') === 'true'
    );

    const toggleCollapse = function() {
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
    type: details.type,
}).then(response => {
    if ( response === false ) {
        window.location.replace(details.url);
    }
});

/******************************************************************************/

// <<<<< end of local scope
}

/******************************************************************************/
