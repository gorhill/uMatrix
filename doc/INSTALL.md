## INSTALL

### Manual installation

- Download and unzip `uMatrix.chromium-{version}.zip` ([latest release desirable](https://github.com/gorhill/uMatrix/releases)).
- Rename the unzipped directory to `uMatrix.chromium` (if it is different)
    - When you later update manually, replace the **content** of the `uMatrix.chromium` folder with the **content** of the latest zipped version.
    - This will ensure that all the extension settings will be preserved
    - As long as the extension loads **from same folder path from which it was originally installed**, all your settings will be preserved.
- Go to chromium/chrome *Extensions*.
- Click to check *Developer mode*.
- Click *Load unpacked extension...*.
- In the file selector dialog:
    - Select the directory `uMatrix.chromium` which was created above.
    - Click *Open*.

The extension will now be available in your chromium/chromium-based browser.

Remember that you have to update manually also. For some users, updating manually is actually an advantage because:
- You can update when **you** want
- If ever a new version sucks, you can easily just re-installed the previous one

### Vendor stores

- Opera store (coming)
- Chrome store (coming)
