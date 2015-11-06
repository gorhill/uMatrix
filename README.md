**Regarding the new required Chromium permission as of 0.9.1.2**: [About the required permissions: change your privacy related settings](https://github.com/gorhill/uMatrix/releases/tag/0.9.1.2).

## uMatrix<br>[<img src="https://travis-ci.org/gorhill/uMatrix.svg?branch=master" height="16">](https://travis-ci.org/gorhill/uMatrix)

Definitely for advanced users.

Keep Github issues for bugs. User support is [Mozilla's add-on-support](https://discourse.mozilla-community.org/t/support-umatrix/5131).

Forked and refactored from [HTTP Switchboard](https://github.com/gorhill/httpswitchboard).

Install [manually](https://github.com/gorhill/uMatrix/blob/master/doc/README.md) the [latest release](https://github.com/gorhill/uMatrix/releases), or install from:
- [Firefox AMO](https://addons.mozilla.org/firefox/addon/umatrix/)
- [Chrome store](https://chrome.google.com/webstore/detail/µmatrix/ogfcmafjalglgifnmanfmnieipoejdcf)
- [Opera store](https://addons.opera.com/en-gb/extensions/details/umatrix/)

You may contribute with translation work:
- For in-app strings, on Crowdin: [uMatrix on Crowdin](https://crowdin.com/project/umatrix).
- For [description](https://github.com/gorhill/uMatrix/tree/master/doc/description) (to be used in AMO, Chrome store, etc.), submit a pull request. [Reference description is here](https://github.com/gorhill/uMatrix/blob/master/doc/description/description.txt) (feel free to improve as you wish, I am not a writer).

[HTTP Switchboard's documentation](https://github.com/gorhill/httpswitchboard/wiki) is still relevant, except for [uMatrix's differences with HTTP Switchboard](https://github.com/gorhill/uMatrix/wiki/Changes-from-HTTP-Switchboard).

You may contribute with documentation: [uMatrix's wiki](https://github.com/gorhill/uMatrix/wiki).

## Warnings

#### Regarding broken sites

uMatrix does not guarantee that sites will work fine: it is for advanced users who can figure how to un-break sites, because essentially uMatrix is a firewall which works in relaxed block-all/allow-exceptionally mode out of the box: it is not unexpected that sites will break.

**So this means do not file issues to report broken sites when the sites are broken because uMatrix does its job as expected.** I will close any such issue without further comment.

I expect there will be community driven efforts for users to help each others. If uMatrix had a home, I would probably set up a forum, but I do not plan for such thing, I really just want to code, not manage web sites. If you need help to un-break a site when using uMatrix, you can try [Wilders Security](http://www.wilderssecurity.com/threads/umatrix-the-http-switchboard-successor.369601/), where you are likely to receive help if needed, whether by me or other users.

uMatrix can be set to work in [allow-all/block-exceptionally](https://github.com/gorhill/httpswitchboard/wiki/How-to-use-HTTP-Switchboard:-Two-opposing-views#the-allow-allblock-exceptionally-approach) mode with a single click on the `all` cell in the global scope `*`, if you prefer to work this way. This will of course break less sites, but you would then lose all the benefits which comes with block-all/allow-exceptionally mode -- though you will still benefit from the 62,000+ blacklisted hostnames by default.


## License

<a href="https://github.com/gorhill/umatrix/blob/master/LICENSE.txt">GPLv3</a>.
