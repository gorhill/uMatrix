/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
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

/* global uDom, faIconsInit */

'use strict';

/******************************************************************************/

(function() {

/******************************************************************************/

self.cloud = {
    options: {},
    datakey: '',
    data: undefined,
    onPush: null,
    onPull: null
};

/******************************************************************************/

var widget = uDom.nodeFromId('cloudWidget');
if ( widget === null ) {
    return;
}

self.cloud.datakey = widget.getAttribute('data-cloud-entry') || '';
if ( self.cloud.datakey === '' ) {
    return;
}

/******************************************************************************/

var onCloudDataReceived = function(entry) {
    if ( entry instanceof Object === false ) { return; }

    self.cloud.data = entry.data;

    uDom.nodeFromId('cloudPull').removeAttribute('disabled');
    uDom.nodeFromId('cloudPullAndMerge').removeAttribute('disabled');

    let timeOptions = {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        timeZoneName: 'short'
    };

    let time = new Date(entry.tstamp);
    widget.querySelector('[data-i18n="cloudNoData"]').textContent =
        entry.source + '\n' +
        time.toLocaleString('fullwide', timeOptions);
};

/******************************************************************************/

var fetchCloudData = function() {
    vAPI.messaging.send(
        'cloud-ui.js',
        {
            what: 'cloudPull',
            datakey: self.cloud.datakey
        },
        onCloudDataReceived
    );
};

/******************************************************************************/

var pushData = function() {
    if ( typeof self.cloud.onPush !== 'function' ) {
        return;
    }
    vAPI.messaging.send(
        'cloud-ui.js',
        {
            what: 'cloudPush',
            datakey: self.cloud.datakey,
            data: self.cloud.onPush()
        },
        fetchCloudData
    );
};

/******************************************************************************/

var pullData = function(ev) {
    if ( typeof self.cloud.onPull === 'function' ) {
        self.cloud.onPull(self.cloud.data, ev.shiftKey);
    }
};

/******************************************************************************/

var pullAndMergeData = function() {
    if ( typeof self.cloud.onPull === 'function' ) {
        self.cloud.onPull(self.cloud.data, true);
    }
};

/******************************************************************************/

var openOptions = function() {
    let input = uDom.nodeFromId('cloudDeviceName');
    input.value = self.cloud.options.deviceName;
    input.setAttribute('placeholder', self.cloud.options.defaultDeviceName);
    uDom.nodeFromId('cloudOptions').classList.add('show');
};

/******************************************************************************/

var closeOptions = function(ev) {
    let root = uDom.nodeFromId('cloudOptions');
    if ( ev.target !== root ) {
        return;
    }
    root.classList.remove('show');
};

/******************************************************************************/

var submitOptions = function() {
    let onOptions = function(options) {
        if ( typeof options !== 'object' || options === null ) {
            return;
        }
        self.cloud.options = options;
    };

    vAPI.messaging.send('cloud-ui.js', {
        what: 'cloudSetOptions',
        options: {
            deviceName: uDom.nodeFromId('cloudDeviceName').value
        }
    }, onOptions);
    uDom.nodeFromId('cloudOptions').classList.remove('show');
};

/******************************************************************************/

var onInitialize = function(options) {
    if ( typeof options !== 'object' || options === null ) { return; }

    if ( !options.enabled ) { return; }
    self.cloud.options = options;

    let xhr = new XMLHttpRequest();
    xhr.open('GET', 'cloud-ui.html', true);
    xhr.overrideMimeType('text/html;charset=utf-8');
    xhr.responseType = 'text';
    xhr.onload = function() {
        this.onload = null;
        let parser = new DOMParser(),
            parsed = parser.parseFromString(this.responseText, 'text/html'),
            fromParent = parsed.body;
        while ( fromParent.firstElementChild !== null ) {
            widget.appendChild(
                document.adoptNode(fromParent.firstElementChild)
            );
        }

        faIconsInit(widget);

        vAPI.i18n.render(widget);
        widget.classList.remove('hide');

        uDom('#cloudPush').on('click', pushData);
        uDom('#cloudPull').on('click', pullData);
        uDom('#cloudPullAndMerge').on('click', pullAndMergeData);
        uDom('#cloudCog').on('click', openOptions);
        uDom('#cloudOptions').on('click', closeOptions);
        uDom('#cloudOptionsSubmit').on('click', submitOptions);

        fetchCloudData();
    };
    xhr.send();
};

vAPI.messaging.send('cloud-ui.js', { what: 'cloudGetOptions' }, onInitialize);

/******************************************************************************/

// https://www.youtube.com/watch?v=aQFp67VoiDA

})();
