/*******************************************************************************

    uMatrix - a browser extension to black/white list requests.
    Copyright (C) 2014-2018 Raymond Hill

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

/* global publicSuffixList, punycode */

'use strict';

/*******************************************************************************

RFC 3986 as reference: http://tools.ietf.org/html/rfc3986#appendix-A

Naming convention from https://en.wikipedia.org/wiki/URI_scheme#Examples

*/

/******************************************************************************/

µMatrix.URI = (function() {

/******************************************************************************/

// Favorite regex tool: http://regex101.com/

// Ref: <http://tools.ietf.org/html/rfc3986#page-50>
// I removed redundant capture groups: capture less = peform faster. See
// <http://jsperf.com/old-uritools-vs-new-uritools>
// Performance improvements welcomed.
// jsperf: <http://jsperf.com/old-uritools-vs-new-uritools>
var reRFC3986 = /^([^:\/?#]+:)?(\/\/[^\/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?/;

// Derived
var reSchemeFromURI          = /^[^:\/?#]+:/;
var reAuthorityFromURI       = /^(?:[^:\/?#]+:)?(\/\/[^\/?#]+)/;
var reCommonHostnameFromURL  = /^https?:\/\/([0-9a-z_][0-9a-z._-]*[0-9a-z])\//;
var reMustNormalizeHostname  = /[^0-9a-z._-]/;

// These are to parse authority field, not parsed by above official regex
// IPv6 is seen as an exception: a non-compatible IPv6 is first tried, and
// if it fails, the IPv6 compatible regex istr used. This helps
// peformance by avoiding the use of a too complicated regex first.

// https://github.com/gorhill/httpswitchboard/issues/211
// "While a hostname may not contain other characters, such as the
// "underscore character (_), other DNS names may contain the underscore"
var reHostPortFromAuthority  = /^(?:[^@]*@)?([^:]*)(:\d*)?$/;
var reIPv6PortFromAuthority  = /^(?:[^@]*@)?(\[[0-9a-f:]*\])(:\d*)?$/i;

var reHostFromNakedAuthority = /^[0-9a-z._-]+[0-9a-z]$/i;
var reHostFromAuthority      = /^(?:[^@]*@)?([^:]+)(?::\d*)?$/;
var reIPv6FromAuthority      = /^(?:[^@]*@)?(\[[0-9a-f:]+\])(?::\d*)?$/i;

// Coarse (but fast) tests
var reIPAddressNaive         = /^\d+\.\d+\.\d+\.\d+$|^\[[\da-zA-Z:]+\]$/;

// Accurate tests
// Source.: http://stackoverflow.com/questions/5284147/validating-ipv4-addresses-with-regexp/5284410#5284410
//var reIPv4                   = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)(\.|$)){4}/;

// Source: http://forums.intermapper.com/viewtopic.php?p=1096#1096
//var reIPv6                   = /^\s*((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))(%.+)?\s*$/;

/******************************************************************************/

var reset = function(o) {
    o.scheme = '';
    o.hostname = '';
    o._ipv4 = undefined;
    o._ipv6 = undefined;
    o.port = '';
    o.path = '';
    o.query = '';
    o.fragment = '';
    return o;
};

var resetAuthority = function(o) {
    o.hostname = '';
    o._ipv4 = undefined;
    o._ipv6 = undefined;
    o.port = '';
    return o;
};

/******************************************************************************/

// This will be exported

var URI = {
    scheme:      '',
    authority:   '',
    hostname:    '',
    _ipv4:       undefined,
    _ipv6:       undefined,
    port:        '',
    domain:      undefined,
    path:        '',
    query:       '',
    fragment:    '',
    schemeBit:   (1 << 0),
    userBit:     (1 << 1),
    passwordBit: (1 << 2),
    hostnameBit: (1 << 3),
    portBit:     (1 << 4),
    pathBit:     (1 << 5),
    queryBit:    (1 << 6),
    fragmentBit: (1 << 7),
    allBits:     (0xFFFF)
};

URI.authorityBit  = (URI.userBit | URI.passwordBit | URI.hostnameBit | URI.portBit);
URI.normalizeBits = (URI.schemeBit | URI.hostnameBit | URI.pathBit | URI.queryBit);

/******************************************************************************/

// See: https://en.wikipedia.org/wiki/URI_scheme#Examples
//     URI = scheme ":" hier-part [ "?" query ] [ "#" fragment ]
//
//       foo://example.com:8042/over/there?name=ferret#nose
//       \_/   \______________/\_________/ \_________/ \__/
//        |           |            |            |        |
//     scheme     authority       path        query   fragment
//        |   _____________________|__
//       / \ /                        \
//       urn:example:animal:ferret:nose

URI.set = function(uri) {
    if ( uri === undefined ) {
        return reset(URI);
    }
    var matches = reRFC3986.exec(uri);
    if ( !matches ) {
        return reset(URI);
    }
    this.scheme = matches[1] !== undefined ? matches[1].slice(0, -1) : '';
    this.authority = matches[2] !== undefined ? matches[2].slice(2).toLowerCase() : '';
    this.path = matches[3] !== undefined ? matches[3] : '';

    // <http://tools.ietf.org/html/rfc3986#section-6.2.3>
    // "In general, a URI that uses the generic syntax for authority
    // "with an empty path should be normalized to a path of '/'."
    if ( this.authority !== '' && this.path === '' ) {
        this.path = '/';
    }
    this.query = matches[4] !== undefined ? matches[4].slice(1) : '';
    this.fragment = matches[5] !== undefined ? matches[5].slice(1) : '';

    // Assume very simple authority, i.e. just a hostname (highest likelihood
    // case for µMatrix)
    if ( reHostFromNakedAuthority.test(this.authority) ) {
        this.hostname = this.authority;
        this.port = '';
        return this;
    }
    // Authority contains more than just a hostname
    matches = reHostPortFromAuthority.exec(this.authority);
    if ( !matches ) {
        matches = reIPv6PortFromAuthority.exec(this.authority);
        if ( !matches ) {
            return resetAuthority(URI);
        }
    }
    this.hostname = matches[1] !== undefined ? matches[1] : '';
    // http://en.wikipedia.org/wiki/FQDN
    if ( this.hostname.slice(-1) === '.' ) {
        this.hostname = this.hostname.slice(0, -1);
    }
    this.port = matches[2] !== undefined ? matches[2].slice(1) : '';
    return this;
};

/******************************************************************************/

//     URI = scheme ":" hier-part [ "?" query ] [ "#" fragment ]
//
//       foo://example.com:8042/over/there?name=ferret#nose
//       \_/   \______________/\_________/ \_________/ \__/
//        |           |            |            |        |
//     scheme     authority       path        query   fragment
//        |   _____________________|__
//       / \ /                        \
//       urn:example:animal:ferret:nose

URI.assemble = function(bits) {
    if ( bits === undefined ) {
        bits = this.allBits;
    }
    var s = [];
    if ( this.scheme && (bits & this.schemeBit) ) {
        s.push(this.scheme, ':');
    }
    if ( this.hostname && (bits & this.hostnameBit) ) {
        s.push('//', this.hostname);
    }
    if ( this.port && (bits & this.portBit) ) {
        s.push(':', this.port);
    }
    if ( this.path && (bits & this.pathBit) ) {
        s.push(this.path);
    }
    if ( this.query && (bits & this.queryBit) ) {
        s.push('?', this.query);
    }
    if ( this.fragment && (bits & this.fragmentBit) ) {
        s.push('#', this.fragment);
    }
    return s.join('');
};

/******************************************************************************/

URI.schemeFromURI = function(uri) {
    var matches = reSchemeFromURI.exec(uri);
    if ( matches === null ) {
        return '';
    }
    return matches[0].slice(0, -1).toLowerCase();
};

/******************************************************************************/

const reNetworkScheme = /^(?:https?|wss?|ftps?)\b/;

URI.isNetworkScheme = function(scheme) {
    return reNetworkScheme.test(scheme);
};

/******************************************************************************/

URI.isSecureScheme = function(scheme) {
    return this.reSecureScheme.test(scheme);
};

URI.reSecureScheme = /^(?:https|wss|ftps)\b/;

/******************************************************************************/

// The most used function, so it better be fast.

// https://github.com/gorhill/uBlock/issues/1559
//   See http://en.wikipedia.org/wiki/FQDN
// https://bugzilla.mozilla.org/show_bug.cgi?id=1360285
//   Revisit punycode dependency when above issue is fixed in Firefox.

URI.hostnameFromURI = function(uri) {
    var matches = reCommonHostnameFromURL.exec(uri);
    if ( matches !== null ) { return matches[1]; }
    matches = reAuthorityFromURI.exec(uri);
    if ( matches === null ) { return ''; }
    var authority = matches[1].slice(2);
    // Assume very simple authority (most common case for µBlock)
    if ( reHostFromNakedAuthority.test(authority) ) {
        return authority.toLowerCase();
    }
    matches = reHostFromAuthority.exec(authority);
    if ( matches === null ) {
        matches = reIPv6FromAuthority.exec(authority);
        if ( matches === null ) { return ''; }
    }
    var hostname = matches[1];
    while ( hostname.endsWith('.') ) {
        hostname = hostname.slice(0, -1);
    }
    if ( reMustNormalizeHostname.test(hostname) ) {
        hostname = punycode.toASCII(hostname.toLowerCase());
    }
    return hostname;
};

/******************************************************************************/

URI.domainFromHostname = function(hostname) {
    // Try to skip looking up the PSL database
    var entry = domainCache.get(hostname);
    if ( entry !== undefined ) {
        entry.tstamp = Date.now();
        return entry.domain;
    }
    // Meh.. will have to search it
    if ( reIPAddressNaive.test(hostname) === false ) {
        return domainCacheAdd(hostname, psl.getDomain(hostname));
    }
    return domainCacheAdd(hostname, hostname);
};

// It is expected that there is higher-scoped `publicSuffixList` lingering
// somewhere. Cache it. See <https://github.com/gorhill/publicsuffixlist.js>.
var psl = publicSuffixList;

/******************************************************************************/

 // Trying to alleviate the worries of looking up too often the domain name from
// a hostname. With a cache, uBlock benefits given that it deals with a
// specific set of hostnames within a narrow time span -- in other words, I
// believe probability of cache hit are high in uBlock.

var domainCache = new Map();
var domainCacheCountLowWaterMark = 75;
var domainCacheCountHighWaterMark = 100;
var domainCacheEntryJunkyard = [];
var domainCacheEntryJunkyardMax = domainCacheCountHighWaterMark - domainCacheCountLowWaterMark;

var DomainCacheEntry = function(domain) {
    this.init(domain);
};

DomainCacheEntry.prototype.init = function(domain) {
    this.domain = domain;
    this.tstamp = Date.now();
    return this;
};

DomainCacheEntry.prototype.dispose = function() {
    this.domain = '';
    if ( domainCacheEntryJunkyard.length < domainCacheEntryJunkyardMax ) {
        domainCacheEntryJunkyard.push(this);
    }
};

var domainCacheEntryFactory = function(domain) {
    var entry = domainCacheEntryJunkyard.pop();
    if ( entry ) {
        return entry.init(domain);
    }
    return new DomainCacheEntry(domain);
};

var domainCacheAdd = function(hostname, domain) {
    var entry = domainCache.get(hostname);
    if ( entry !== undefined ) {
        entry.tstamp = Date.now();
    } else {
        domainCache.set(hostname, domainCacheEntryFactory(domain));
        if ( domainCache.size === domainCacheCountHighWaterMark ) {
            domainCachePrune();
        }
    }
    return domain;
};

var domainCacheEntrySort = function(a, b) {
    return domainCache.get(b).tstamp - domainCache.get(a).tstamp;
};

var domainCachePrune = function() {
    var hostnames = Array.from(domainCache.keys())
                         .sort(domainCacheEntrySort)
                         .slice(domainCacheCountLowWaterMark);
    var i = hostnames.length;
    var hostname;
    while ( i-- ) {
        hostname = hostnames[i];
        domainCache.get(hostname).dispose();
        domainCache.delete(hostname);
    }
};

window.addEventListener('publicSuffixList', function() {
    domainCache.clear();
});

/******************************************************************************/

URI.domainFromURI = function(uri) {
    if ( !uri ) {
        return '';
    }
    return this.domainFromHostname(this.hostnameFromURI(uri));
};

/******************************************************************************/

// Normalize the way µMatrix expects it

URI.normalizedURI = function() {
    // Will be removed:
    // - port
    // - user id/password
    // - fragment
    return this.assemble(this.normalizeBits);
};

/******************************************************************************/

URI.toString = function() {
    return this.assemble();
};

/******************************************************************************/

// Export

return URI;

/******************************************************************************/

})();

/******************************************************************************/

