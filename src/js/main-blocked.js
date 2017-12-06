/*******************************************************************************

    uMatrix - a browser extension to block requests.
    Copyright (C) 2015-2017 Raymond Hill

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

var details = {};

(function() {
    var matches = /details=([^&]+)/.exec(window.location.search);
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
    if ( typeof URL !== 'function' ) { return; }

    var reURL = /^https?:\/\//;

    var liFromParam = function(name, value) {
        if ( value === '' ) {
            value = name;
            name = '';
        }
        var li = document.createElement('li');
        var span = document.createElement('span');
        span.textContent = name;
        li.appendChild(span);
        if ( name !== '' && value !== '' ) {
            li.appendChild(document.createTextNode(' = '));
        }
        span = document.createElement('span');
        if ( reURL.test(value) ) {
            var a = document.createElement('a');
            a.href = a.textContent = value;
            span.appendChild(a);
        } else {
            span.textContent = value;
        }
        li.appendChild(span);
        return li;
    };

    var safeDecodeURIComponent = function(s) {
        try {
            s = decodeURIComponent(s);
        } catch (ex) {
        }
        return s;
    };

    var renderParams = function(parentNode, rawURL) {
        var a = document.createElement('a');
        a.href = rawURL;
        if ( a.search.length === 0 ) { return false; }

        var pos = rawURL.indexOf('?');
        var li = liFromParam(
            vAPI.i18n('docblockedNoParamsPrompt'),
            rawURL.slice(0, pos)
        );
        parentNode.appendChild(li);

        var params = a.search.slice(1).split('&');
        var param, name, value, ul;
        for ( var i = 0; i < params.length; i++ ) {
            param = params[i];
            pos = param.indexOf('=');
            if ( pos === -1 ) {
                pos = param.length;
            }
            name = safeDecodeURIComponent(param.slice(0, pos));
            value = safeDecodeURIComponent(param.slice(pos + 1));
            li = liFromParam(name, value);
            if ( reURL.test(value) ) {
                ul = document.createElement('ul');
                renderParams(ul, value);
                li.appendChild(ul);
            }
            parentNode.appendChild(li);
        }
        return true;
    };

    if ( renderParams(uDom.nodeFromId('parsed'), details.url) === false ) {
        return;
    }

    var toggler = document.createElement('span');
    toggler.className = 'fa';
    uDom('#theURL > p').append(toggler);

    uDom(toggler).on('click', function() {
        var collapsed = uDom.nodeFromId('theURL').classList.toggle('collapsed');
        vAPI.localStorage.setItem(
            'document-blocked-collapse-url',
            collapsed.toString()
        );
    });

    uDom.nodeFromId('theURL').classList.toggle(
        'collapsed',
        vAPI.localStorage.getItem('document-blocked-collapse-url') === 'true'
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
    type: 'doc'
}, function(response) {
    if ( response === false ) {
        window.location.replace(details.url);
    }
});

/******************************************************************************/

})();

/******************************************************************************/
