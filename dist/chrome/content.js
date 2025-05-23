/**
 * 4chins Batch Downloader Addon
 */

(function () {
    const selected = new Set();
    let selectAllOnDoubleClick = false;
    let downloadBtn = null;
    let zipBtn = null;
    let notificationDiv = null;
    let noDialogBtn = null;
    let ibdContainer = null; // Container for all extension UI
    let modifierKey = 'alt'; // default
    let showNoDialogBtn = false;
    let showIndividualBtn = true;
    let showZipBtn = false;
    let boardFolders = {}; // { board: folder }
    let defaultFolder = '';
    let nameFolders = {}; // { key: { string, label, folder } }
    // Timeouts
    let imageThreshold = 20;
    let timeoutSeconds = 2;
    // Styling
    let buttonPosition = 'top-right';
    // Cancel and busy state
    let isFetching = false;

    // CSS class for glowing border
    const SELECTED_CLASS = 'ibd-selected-thumb';
    const UI_CONTAINER_ID = 'container-4bd';

    // Fetching progress: listen for progress updates from background
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'fetch-progress') {
            if (typeof message.filename === 'string' && message.filename.length > 0) {
                showNotification(`Fetching image ${message.current} of ${message.total}: ${message.filename}`);
            } else {
                showNotification(`Fetching image ${message.current} of ${message.total}...`);
            }
        } else if (message.type === 'fetch-complete' || message.type === 'fetch-cancelled') {
            getAllThumbs().forEach(thumb => thumb.classList.remove(SELECTED_CLASS));
            selected.clear();
            resetButtons();
            hideNotification();
        }
    });

    // Helper: ensure the UI container exists and is attached to the DOM
    function ensureibdContainer() {
        if (!ibdContainer) {
            ibdContainer = document.getElementById(UI_CONTAINER_ID);
            if (!ibdContainer) {
                ibdContainer = document.createElement('div');
                ibdContainer.id = UI_CONTAINER_ID;
                ibdContainer.style.position = 'fixed';
                ibdContainer.style.zIndex = 99999;
                ibdContainer.style.pointerEvents = 'none'; // allow clicks to pass through except for children
                document.body.appendChild(ibdContainer);
            }
        }
        // Reset container position for stacking
        ibdContainer.style.right = '0';
        ibdContainer.style.top = '0';
        ibdContainer.style.bottom = 'auto';
        ibdContainer.style.left = 'auto';
    }

    // Helper: create floating download buttons
    function createDownloadButtons() {
        ensureibdContainer();

        // Remove old buttons and notification from container
        if (downloadBtn && downloadBtn.parentNode) downloadBtn.parentNode.removeChild(downloadBtn);
        if (zipBtn && zipBtn.parentNode) zipBtn.parentNode.removeChild(zipBtn);
        if (noDialogBtn && noDialogBtn.parentNode) noDialogBtn.parentNode.removeChild(noDialogBtn);
        if (notificationDiv && notificationDiv.parentNode) notificationDiv.parentNode.removeChild(notificationDiv);

        downloadBtn = null;
        zipBtn = null;
        noDialogBtn = null;

        let buttonList = [];
        if (showNoDialogBtn) buttonList.push({ type: 'nodialog' });
        if (showIndividualBtn) buttonList.push({ type: 'individual' });
        if (showZipBtn) buttonList.push({ type: 'zip' });

        const buttonHeight = 60; // px
        const totalButtons = buttonList.length;

        buttonList.forEach((btnInfo, idx) => {
            let btn, text, id, clickHandler;
            if (btnInfo.type === 'nodialog') {
                btn = document.createElement('button');
                text = 'Download';
                id = 'ibd-nodialog-btn';
                clickHandler = onNoDialogBtnClick;
                noDialogBtn = btn;
            } else if (btnInfo.type === 'individual') {
                btn = document.createElement('button');
                text = 'Download (Save As...)';
                id = 'ibd-download-btn';
                clickHandler = onDownloadBtnClick;
                downloadBtn = btn;
            } else if (btnInfo.type === 'zip') {
                btn = document.createElement('button');
                text = 'Download as ZIP';
                id = 'ibd-zip-btn';
                clickHandler = onZipBtnClick;
                zipBtn = btn;
            }
            btn.textContent = text;
            btn.id = id;
            let yOffset;
            if (buttonPosition === 'bottom-right') {
                yOffset = buttonHeight * (totalButtons - idx - 1);
            } else {
                yOffset = buttonHeight * idx;
            }
            styleButton(btn, yOffset);
            btn.addEventListener('click', clickHandler);
            btn.style.pointerEvents = 'auto'; // allow clicks
            ibdContainer.appendChild(btn);
        });

        createOrMoveNotificationDiv(totalButtons, buttonHeight);
        updateButtonVisibility();
    }

    // Helper: style floating buttons
    function styleButton(btn, yOffsetPx, totalButtons) {
        btn.style.position = 'fixed';
        btn.style.right = '45px';
        btn.style.zIndex = 99999;
        btn.style.padding = '13px 20px';
        btn.style.color = '#fff';
        btn.style.border = 'none';
        btn.style.borderRadius = '8px';
        btn.style.boxShadow = '0 2px 12px rgba(0,0,0,0.2)';
        btn.style.fontSize = '15px';
        btn.style.cursor = 'pointer';
        btn.style.display = 'none';
        btn.style.transition = 'background 0.2s, color 0.2s';
        btn.style.pointerEvents = 'auto';
        // Positioning
        if (buttonPosition === 'top-right') {
            btn.style.top = `calc(10% + ${yOffsetPx}px)`;
            btn.style.bottom = '';
        } else if (buttonPosition === 'middle') {
            btn.style.top = `calc(35% + ${yOffsetPx}px)`;
            btn.style.bottom = '';
        } else if (buttonPosition === 'bottom-right') {
            // Stack upward from the bottom
            btn.style.top = '';
            btn.style.bottom = `calc(10% + ${yOffsetPx}px)`;
        }
    }

    // Helper: create or move notification div below/above the buttons
    function createOrMoveNotificationDiv(totalButtons, buttonHeight) {
        if (!notificationDiv) {
            notificationDiv = document.createElement('div');
            notificationDiv.id = 'ibd-notification';
            notificationDiv.style.position = 'fixed';
            notificationDiv.style.right = '45px';
            notificationDiv.style.zIndex = 99999;
            notificationDiv.style.background = '#fffbe6';
            notificationDiv.style.color = '#333';
            notificationDiv.style.border = '1px solid #ffe58f';
            notificationDiv.style.borderRadius = '8px';
            notificationDiv.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)';
            notificationDiv.style.padding = '12px 20px';
            notificationDiv.style.fontSize = '15px';
            notificationDiv.style.display = 'none';
            notificationDiv.style.minWidth = '220px';
            notificationDiv.style.pointerEvents = 'auto';
        }
        // Positioning
        if (buttonPosition === 'top-right') {
            // Notification below the last button
            notificationDiv.style.top = `calc(10% + ${totalButtons * buttonHeight}px + 8px)`;
            notificationDiv.style.bottom = '';
        } else if (buttonPosition === 'middle') {
            notificationDiv.style.top = `calc(35% + ${totalButtons * buttonHeight}px + 8px)`;
            notificationDiv.style.bottom = '';
        } else if (buttonPosition === 'bottom-right') {
            // Notification above the topmost button
            notificationDiv.style.top = '';
            notificationDiv.style.bottom = `calc(10% + ${totalButtons * buttonHeight}px + 8px)`;
        }
        if (!notificationDiv.parentNode) {
            ibdContainer.appendChild(notificationDiv);
        }
    }

    // Helper: show/hide/update notification
    function showNotification(msg) {
        if (!notificationDiv) createOrMoveNotificationDiv(showIndividualBtn, showZipBtn);
        notificationDiv.textContent = msg;
        notificationDiv.style.display = 'block';
    }
    function hideNotification() {
        if (notificationDiv) notificationDiv.style.display = 'none';
    }

    // Helper: update button visibility
    function updateButtonVisibility() {
        const visible = selected.size > 0 && !isFetching;
        if (downloadBtn) downloadBtn.style.display = visible ? 'block' : 'none';
        if (zipBtn) zipBtn.style.display = visible ? 'block' : 'none';
        if (noDialogBtn) {
            noDialogBtn.style.display = visible ? 'block' : 'none';
            if (visible) {
                noDialogBtn.textContent = `Download (${selected.size})`;
            } else {
                noDialogBtn.textContent = 'Download';
            }
        }
        if (notificationDiv && !visible) hideNotification();
    }

    // --- Cancel/Busy State Management ---
    function setButtonsToCancel(type) {
        isFetching = true;
        if (downloadBtn) {
            downloadBtn.disabled = type !== 'individual';
        }
        if (zipBtn) {
            zipBtn.disabled = type !== 'zip';
        }
        if (noDialogBtn) {
            noDialogBtn.disabled = type !== 'nodialog';
        }
        // Change text and color for the active button
        if (type === 'individual' && downloadBtn) {
            downloadBtn.textContent = 'Cancel';
            downloadBtn.style.background = '#e74c3c';
            downloadBtn.classList.add('ibd-cancel-btn');
            downloadBtn.removeEventListener('click', onDownloadBtnClick);
            downloadBtn.removeEventListener('click', cancelFetch);
            downloadBtn.addEventListener('click', cancelFetch);
        }
        if (type === 'zip' && zipBtn) {
            zipBtn.textContent = 'Cancel';
            zipBtn.style.background = '#e74c3c';
            zipBtn.classList.add('ibd-cancel-btn');
            zipBtn.removeEventListener('click', onZipBtnClick);
            zipBtn.removeEventListener('click', cancelFetch);
            zipBtn.addEventListener('click', cancelFetch);
        }
        if (type === 'nodialog' && noDialogBtn) {
            noDialogBtn.textContent = 'Cancel';
            noDialogBtn.style.background = '#e74c3c';
            noDialogBtn.classList.add('ibd-cancel-btn');
            noDialogBtn.removeEventListener('click', onNoDialogBtnClick);
            noDialogBtn.removeEventListener('click', cancelFetch);
            noDialogBtn.addEventListener('click', cancelFetch);
        }
    }

    function resetButtons() {
        isFetching = false;
        if (downloadBtn) {
            downloadBtn.classList.remove('ibd-cancel-btn');
            downloadBtn.style.background = '';
            downloadBtn.textContent = 'Download (Save As...)';
            downloadBtn.disabled = false;
            downloadBtn.removeEventListener('click', cancelFetch);
            downloadBtn.removeEventListener('click', onDownloadBtnClick);
            downloadBtn.addEventListener('click', onDownloadBtnClick);
        }
        if (zipBtn) {
            zipBtn.classList.remove('ibd-cancel-btn');
            zipBtn.style.background = '';
            zipBtn.textContent = 'Download as ZIP';
            zipBtn.disabled = false;
            zipBtn.removeEventListener('click', cancelFetch);
            zipBtn.removeEventListener('click', onZipBtnClick);
            zipBtn.addEventListener('click', onZipBtnClick);
        }
        if (noDialogBtn) {
            noDialogBtn.classList.remove('ibd-cancel-btn');
            noDialogBtn.style.background = '';
            noDialogBtn.textContent = selected.size > 0 ? `Download (${selected.size})` : 'Download';
            noDialogBtn.disabled = false;
            noDialogBtn.removeEventListener('click', cancelFetch);
            noDialogBtn.removeEventListener('click', onNoDialogBtnClick);
            noDialogBtn.addEventListener('click', onNoDialogBtnClick);
        }
        updateButtonVisibility();
    }
    function cancelFetch() {
        if (!isFetching) return;
        showNotification('Cancelling...');
        chrome.runtime.sendMessage({ action: "cancelDownload" });
        // UI will reset when background sends fetch-cancelled or fetch-complete
    }

    // Button click handlers
    function onDownloadBtnClick() {
        if (isFetching) return;
        setButtonsToCancel('individual');
        downloadSelectedImages();
    }
    function onZipBtnClick() {
        if (isFetching) return;
        setButtonsToCancel('zip');
        downloadSelectedImagesAsZip();
    }
    function onNoDialogBtnClick() {
        if (isFetching) return;
        setButtonsToCancel('nodialog');
        downloadSelectedImagesNoDialog();
    }

    // Helper: get current board name from URL (e.g. "a" from https://boards.4chan.org/a/thread/...)
    function getCurrentBoard() {
        const match = window.location.pathname.match(/^\/([a-z0-9]+)\//i);
        return match ? match[1] : '';
    }

    // Helper: get folder for current board
    function getDownloadFolder() {
        const board = getCurrentBoard();
        if (boardFolders && boardFolders[board]) {
            return defaultFolder ? `${defaultFolder}/${boardFolders[board]}` : boardFolders[board];
        }
        return defaultFolder || '';
    }

    // Helper: Get Original Filename and Name for Per-Name Download Folders
    function getSelectedFiles() {
        // Returns array of { url, originalFilename, name }
        const files = [];
        selected.forEach(url => {
            // Find the .fileThumb with this href
            const thumb = document.querySelector(`.fileThumb[href="${url}"]`);
            let originalFilename = null;
            let name = null;
            if (thumb) {
                // Try .fileText-original first
                const fileDiv = thumb.closest('.file');
                if (fileDiv) {
                    // Original filename
                    const origSpan = fileDiv.querySelector('.fileText-original a');
                    if (origSpan) {
                        originalFilename = origSpan.textContent.trim();
                    } else {
                        // Fallback: .file-info a
                        const infoSpan = fileDiv.querySelector('.file-info a');
                        if (infoSpan) {
                            originalFilename = infoSpan.textContent.trim();
                        }
                    }
                }
                // Name (poster)
                // Traverse up to .post, then find .name inside .nameBlock
                let postDiv = thumb.closest('.post');
                if (postDiv) {
                    const nameSpan = postDiv.querySelector('.nameBlock .name');
                    if (nameSpan) {
                        name = nameSpan.textContent.trim();
                    }
                }
            }
            files.push({ url, originalFilename, name });
        });
        return files;
    }

    // Helper: Download all selected images, no dialog (send to background)
    function downloadSelectedImagesNoDialog() {
        if (selected.size === 0) return;
        const files = getSelectedFiles();
        const folder = getDownloadFolder();
        showNotification('Fetching images...');
        chrome.storage.sync.get(['useOriginalFilenames', 'nameFolders'], (opts) => {
            opts = opts || {};
            chrome.runtime.sendMessage({
                action: "downloadImages",
                files: files,
                zip: false,
                folder,
                noDialog: true,
                imageThreshold,
                timeoutSeconds,
                useOriginalFilenames: !!opts.useOriginalFilenames,
                nameFolders: opts.nameFolders || {}
            }, () => {
                getAllThumbs().forEach(thumb => thumb.classList.remove(SELECTED_CLASS));
                selected.clear();
                updateButtonVisibility();
            });
        });
    }

    // Helper: download all selected images (send to background)
    function downloadSelectedImages() {
        if (selected.size === 0) return;
        const files = getSelectedFiles();
        const folder = getDownloadFolder();
        showNotification('Fetching images...');
        chrome.storage.sync.get(['useOriginalFilenames', 'nameFolders'], (opts) => {
            opts = opts || {};
            chrome.runtime.sendMessage({
                action: "downloadImages",
                files: files,
                zip: false,
                folder,
                imageThreshold,
                timeoutSeconds,
                useOriginalFilenames: !!opts.useOriginalFilenames,
                nameFolders: opts.nameFolders || {}
            }, () => {
                getAllThumbs().forEach(thumb => thumb.classList.remove(SELECTED_CLASS));
                selected.clear();
                updateButtonVisibility();
            });
        });
    }

    // Helper: download all selected images as zip (send to background)
    function downloadSelectedImagesAsZip() {
        if (selected.size === 0) return;
        const files = getSelectedFiles();
        const folder = getDownloadFolder();
        showNotification('Fetching images and creating ZIP...');
        chrome.storage.sync.get(['useOriginalFilenames', 'nameFolders'], (opts) => {
            opts = opts || {};
            chrome.runtime.sendMessage({
                action: "downloadImages",
                files: files,
                zip: true,
                folder,
                imageThreshold,
                timeoutSeconds,
                useOriginalFilenames: !!opts.useOriginalFilenames,
                nameFolders: opts.nameFolders || {}
            }, () => {
                getAllThumbs().forEach(thumb => thumb.classList.remove(SELECTED_CLASS));
                selected.clear();
                updateButtonVisibility();
            });
        });
    }

    // Helper: get all .fileThumb elements
    function getAllThumbs() {
        return Array.from(document.querySelectorAll('.fileThumb'));
    }

    // Helper: Prevent default key events
    function onThumbClick(e) {
        // Only act if one the configured modifier key is pressed
        if (
            (modifierKey === 'alt' && e.altKey) ||
            (modifierKey === 'ctrl' && e.ctrlKey) ||
            (modifierKey === 'shift' && e.shiftKey) ||
            (modifierKey === 'meta' && e.metaKey)
        ) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    // Helper: Double-click to select all
    function onThumbDoubleClick(e) {
        // Only act if the configured modifier key is pressed
        if (
            (modifierKey === 'alt' && !e.altKey) ||
            (modifierKey === 'ctrl' && !e.ctrlKey) ||
            (modifierKey === 'shift' && !e.shiftKey) ||
            (modifierKey === 'meta' && !e.metaKey)
        ) {
            return;
        }

        const allThumbs = getAllThumbs();
        const allUrls = allThumbs.map(thumb => thumb.href);
        const allSelected = allUrls.every(url => selected.has(url));

        if (allSelected) {
            // Unselect all
            selected.clear();
            allThumbs.forEach(thumb => thumb.classList.remove(SELECTED_CLASS));
        } else {
            // Select all
            allUrls.forEach(url => selected.add(url));
            allThumbs.forEach(thumb => thumb.classList.add(SELECTED_CLASS));
        }
        updateButtonVisibility();
    }

    // Event handler for configurable modifier key + click on thumbnail
    function onThumbMouseDown(e) {
        if (e.button !== 0) return; // Only left mouse button
        // Check the configured modifier key
        if (
            (modifierKey === 'alt' && !e.altKey) ||
            (modifierKey === 'ctrl' && !e.ctrlKey) ||
            (modifierKey === 'shift' && !e.shiftKey) ||
            (modifierKey === 'meta' && !e.metaKey)
        ) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();

        const thumb = e.currentTarget;
        const url = thumb.href;
        if (selected.has(url)) {
            selected.delete(url);
            thumb.classList.remove(SELECTED_CLASS);
        } else {
            selected.add(url);
            thumb.classList.add(SELECTED_CLASS);
        }
        updateButtonVisibility();
    }

    // Attach listeners to all thumbs
    function attachListeners() {
        getAllThumbs().forEach(thumb => {
            thumb.removeEventListener('mousedown', onThumbMouseDown, true);
            thumb.addEventListener('mousedown', onThumbMouseDown, true);

            thumb.removeEventListener('click', onThumbClick, true);
            thumb.addEventListener('click', onThumbClick, true);

            thumb.removeEventListener('dblclick', onThumbDoubleClick, true);
            if (selectAllOnDoubleClick) {
                thumb.addEventListener('dblclick', onThumbDoubleClick, true);
            }
        });
    }

    // Observe DOM for new thumbnails (for dynamic boards)
    const observer = new MutationObserver(() => {
        attachListeners();
    });

    // Initial setup
    function init() {
        // Load options and create buttons on startup
        function setIbdCssVariables(buttonColor, glowColor) {
            ensureibdContainer();
            if (!ibdContainer) return;
            document.documentElement.style.setProperty('--ibd-button-color', buttonColor || '#2d8cf0');
            document.documentElement.style.setProperty('--ibd-glow-color', glowColor || '#2d8cf0');
        }

        chrome.storage.sync.get([
            'modifierKey', 'selectAllOnDoubleClick', 'showNoDialogBtn', 'showIndividualBtn', 'showZipBtn',
            'boardFolders', 'defaultFolder', 'imageThreshold', 'timeoutSeconds', 'buttonPosition', 'useOriginalFilenames', 'buttonColor', 'glowColor', 'nameFolders'
        ], (items) => {
            items = items || {};
            buttonColor = items.buttonColor || '#2d8cf0';
            glowColor = items.glowColor || '#2d8cf0';
            buttonPosition = items.buttonPosition || 'top-right';
            imageThreshold = typeof items.imageThreshold === 'number' ? items.imageThreshold : 20;
            timeoutSeconds = typeof items.timeoutSeconds === 'number' ? items.timeoutSeconds : 2;
            modifierKey = items.modifierKey || 'alt';
            selectAllOnDoubleClick = !!items.selectAllOnDoubleClick;
            showIndividualBtn = items.showIndividualBtn !== false;
            showZipBtn = !!items.showZipBtn;
            showNoDialogBtn = !!items.showNoDialogBtn;
            boardFolders = items.boardFolders || {};
            defaultFolder = items.defaultFolder || '';
            useOriginalFilenames = !!items.useOriginalFilenames;
            nameFolders = items.nameFolders || {};
            setIbdCssVariables(buttonColor, glowColor);
            createDownloadButtons();
            attachListeners();
            observer.observe(document.body, { childList: true, subtree: true });
        });

        // Listen for option changes and update buttons live
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync' && (
                changes.showIndividualBtn || changes.showZipBtn || changes.showNoDialogBtn ||
                changes.modifierKey || changes.boardFolders || changes.defaultFolder ||
                changes.imageThreshold || changes.timeoutSeconds || changes.buttonPosition || changes.useOriginalFilenames || changes.buttonColor || changes.glowColor || changes.nameFolders
            )) {
                chrome.storage.sync.get([
                    'modifierKey', 'selectAllOnDoubleClick', 'showNoDialogBtn', 'showIndividualBtn', 'showZipBtn',
                    'boardFolders', 'defaultFolder', 'imageThreshold', 'timeoutSeconds', 'buttonPosition', 'useOriginalFilenames', 'buttonColor', 'glowColor', 'nameFolders'
                ], (items) => {
                    items = items || {};
                    buttonColor = items.buttonColor || '#2d8cf0';
                    glowColor = items.glowColor || '#2d8cf0';
                    buttonPosition = items.buttonPosition || 'top-right';
                    imageThreshold = typeof items.imageThreshold === 'number' ? items.imageThreshold : 20;
                    timeoutSeconds = typeof items.timeoutSeconds === 'number' ? items.timeoutSeconds : 2;
                    modifierKey = items.modifierKey || 'alt';
                    selectAllOnDoubleClick = !!items.selectAllOnDoubleClick;
                    showNoDialogBtn = !!items.showNoDialogBtn;
                    showIndividualBtn = items.showIndividualBtn !== false;
                    showZipBtn = !!items.showZipBtn;
                    boardFolders = items.boardFolders || {};
                    defaultFolder = items.defaultFolder || '';
                    useOriginalFilenames = !!items.useOriginalFilenames;
                    nameFolders = items.nameFolders || {};
                    setIbdCssVariables(buttonColor, glowColor);
                    createDownloadButtons();
                });
            }
        });
    }

    // Only run on 4chan boards
    if (/^https?:\/\/boards\.4chan\.org\//.test(window.location.href)) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }
})();