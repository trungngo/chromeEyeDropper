var BG_VERSION=8;
var NEED_DROPPER_VERSION=8;
var NEED_ED_HELPER_VERSION=6;
var DEFAULT_COLOR="#b48484";

// jQuery like functions

// for get element by id
function $(id) {
    return document.getElementById(id);
}

// Returns -1 if value isn't in array.
// Return position starting from 0 if found
function inArray(value, array) {
  for(var i=0; i<array.length; i++) {
    if (array[i] == value) return i;
  }
  return -1;
}

// base bg object
var bg = {
  tab: 0,
  tabs: [],
  helperFile: "js/ed_helper.js",
  version: BG_VERSION,
  dropperLoaded: false,
  dropperVersion: 0,
  screenshotData: '',
  screenshotFormat: 'png',
  canvas: document.createElement("canvas"),
  canvasContext: null,
  debugImage: null,
  debugTab: 0,
  color: null,

  // use selected tab
  // need to null all tab-specific variables
  useTab: function(tab) {
    bg.tab = tab;
    bg.dropperLoaded = false;
    bg.dropperVersion = 0;
    bg.screenshotData = '';
    bg.canvas = document.createElement("canvas");
    bg.canvasContext = null;

    bg.sendMessage({type: 'edropper-loaded'}, function(res) {
      bg.dropperLoaded = true; 
      bg.dropperVersion = res.version;
      ////console.log('Picker is loaded with version ' + bg.dropperVersion);
    });
  },

  sendMessage: function(message, callback) {
    chrome.tabs.sendMessage(bg.tab.id, message, callback);
  },

  messageListener: function() {
    // simple messages
    chrome.runtime.onMessage.addListener(function(req, sender, sendResponse) {
      switch(req.type) {
        case 'ed-helper-options':
          sendResponse(bg.edHelperOptions(req));
          break;
        case 'activate-from-hotkey':
          bg.activate2();
          sendResponse({});
          break;

        // Define what background script supports
        case 'supports': bg.supports(req.what, sendResponse); break;

        // Reload background script
        case 'reload-background': window.location.reload(); break;

        // Clear colors history
        case 'clear-history': bg.clearHistory(sendResponse); break;
      }
    });

    // longer connections
    chrome.extension.onConnect.addListener(function(port) {
      port.onMessage.addListener(function(req) {
        switch(req.type) {
          // Taking screenshot for content script
          case 'screenshot': 
            ////console.log('received screenshot request');
            bg.capture(); break;
          
          // Creating debug tab
          case 'debug-tab':
            ////console.log('received debug tab');
            bg.debugImage = req.image;
            bg.createDebugTab();
            break;

          // Set color given in req
          case 'set-color': bg.setColor(req); break;

        }
      });
    });
  },

  // shortcut for injecting new content
  inject: function(file, tab) {
    if ( tab == undefined )
      tab = bg.tab.id;

    ////console.log("Injecting " + file + " into tab " + tab);
    chrome.tabs.executeScript(tab, {allFrames: false, file: file}, function() {});
  },

  // load options for ed helper and send them
  edHelperOptions: function(req) {
    var hotkeyActivate = null;

    if ( window.localStorage != null ) {
      if ( window.localStorage.keyActivate != undefined && window.localStorage.keyActivate != "" )
        hotkeyActivate = window.localStorage.keyActivate;
    } 

    return {options: {hotkeyActivate: hotkeyActivate}};
  },

  supports: function(what, sendResponse) {
    var state = 'no';
    if ( what == 'dummy' || what == 'history' )
      state = 'ok';

    sendResponse({state: state});
  },

  // method for setting color. It set bg color, update badge and save to history if possible
  setColor: function(req) {
    // we are storing color with first # character
    if ( ! req.color.rgbhex.match(/^#/) )
        req.color.rgbhex = '#' + req.color.rgbhex;

    bg.color = req.color.rgbhex;
    chrome.browserAction.setBadgeText({text: ' '});
    chrome.browserAction.setBadgeBackgroundColor({color: [req.color.r, req.color.g, req.color.b, 255]});

    // local storage only if available
    if ( window.localStorage != null ) {
      // save to clipboard through small hack
      if ( window.localStorage['autoClipboard'] === "true" ) {
        var edCb = $('edClipboard');
        edCb.value = window.localStorage['autoClipboardNoGrid'] === "true" ? bg.color.substring(1) : bg.color;
        edCb.select();
        document.execCommand("copy", false, null);
      }

      // history can be disabled i.e when setting color from
      // history itself
      if ( req.history == undefined || req.history != 'no' ) {
        var history = JSON.parse(window.localStorage.history);
        // first check if there isn't same color in history
        if ( inArray(bg.color, history) < 0 ) {
          history.push(bg.color);
          window.localStorage.history = JSON.stringify(history);
        }
      }
    }
  },

  // activate from content script
  activate2: function() {
    chrome.tabs.getSelected(null, function(tab) {
      bg.useTab(tab);
      bg.activate();
    });
  },

  // activate Pick
  activate: function() {
    // inject javascript if needed
    if ( bg.dropperLoaded === false ) {
      ////console.log('trying to inject jquery');
      chrome.tabs.executeScript(bg.tab.id, {allFrames: false, file: "inc/jquery-1.7.1.min.js"}, function() {
        ////console.log('jquery injected');
        chrome.tabs.executeScript(bg.tab.id, {allFrames: false, file: "inc/jquery-special-scroll.js"}, function() {
          ////console.log('jquery-special-scroll injected');
          chrome.tabs.executeScript(bg.tab.id, {allFrames: false, file: "edropper2.js"}, function() {
            ////console.log('edropper2 injected');

            bg.pickupActivate();

          });
        });
      });

    // dropper is loaded but with old version
    } else if ( bg.dropperVersion == undefined || bg.dropperVersion < NEED_DROPPER_VERSION ) {
      chrome.tabs.executeScript(bg.tab.id, {allFrames: true, file: "edropper2.js"}, function() {
        ////console.log('new version of edropper2 injected');
        bg.pickupActivate();
      });

    // dropper is loaded, activate
    } else
      bg.pickupActivate();
  },

  pickupActivate: function() {
    // load options
    cursor = (window.localStorage.dropperCursor === 'crosshair') ? 'crosshair' : 'default';
    enableColorToolbox = (window.localStorage.enableColorToolbox === "false") ? false : true;
    enableColorTooltip = (window.localStorage.enableColorTooltip === "false") ? false : true;
    enableRightClickDeactivate = (window.localStorage.enableRightClickDeactivate === "false") ? false : true;

    // activate picker
    bg.sendMessage({type: 'pickup-activate', options: { cursor: cursor, enableColorToolbox: enableColorToolbox, enableColorTooltip: enableColorTooltip, enableRightClickDeactivate: enableRightClickDeactivate}}, function() {});

    ////console.log('activating pickup');
  },

  // capture actual Screenshot
  capture: function() {
    ////console.log('capturing');
    try {
      chrome.tabs.captureVisibleTab(null, {format: bg.screenshotFormat, quality: 100}, bg.doCapture);
    // fallback for chrome before 5.0.372.0
    } catch(e) {
      chrome.tabs.captureVisibleTab(null, bg.doCapture);
    }
  },

  getColor: function() {
      return bg.color;
  },

  doCapture: function(data) {
      ////console.log('sending updated image');
      bg.sendMessage({type: 'update-image', data: data}, function() {});
  },

  createDebugTab: function() {
    // DEBUG
    if ( bg.debugTab != 0 ) {
      chrome.tabs.sendMessage(bg.debugTab, {type: 'update'});
    } else
      chrome.tabs.create({url: 'debugimage.html', selected: false}, function(tab) { bg.debugTab = tab.id });
  },

  isThisPlatform: function(operationSystem) {
    return navigator.userAgent.toLowerCase().indexOf(operationSystem) > -1;
  },

  tabOnChangeListener: function() {
    // deactivate dropper if tab changed
    chrome.tabs.onSelectionChanged.addListener(function(tabId, selectInfo) {
      if ( bg.tab.id == tabId )
        bg.sendMessage({type: 'pickup-deactivate'}, function() {});
    });

  },

  tabOnUpdatedListener: function() {
    chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
      if ( tab.url.indexOf('http') == 0 && changeInfo.status == "complete" ) {
        ////console.log("Injecting");
        chrome.tabs.executeScript(tabId, {allFrames: false, file: "inc/shortcut.js"});
        chrome.tabs.executeScript(tabId, {allFrames: false, file: bg.helperFile});
      }
    });
  },

  clearHistory: function(sendResponse) {
      ////console.log('clearing history');
      window.localStorage.history = "[]";
      bg.color = DEFAULT_COLOR;

      if ( sendResponse != undefined ) {
          sendResponse({state: 'OK'});
      }
  },
  
  init: function() {
    // only if we have support for localStorage
    if ( window.localStorage != null ) {

      // show installed or updated page
      if ( window.localStorage.seenInstalledPage == undefined || window.localStorage.seenInstalledPage === "false" ) {
        // TODO: for new installs inject ed helper to all tabs
        window.localStorage.seenInstalledPage = true;
        chrome.tabs.create({url: 'pages/installed.html', selected: true});
      }
    }

    // settings from local storage
    if ( window.localStorage.history == undefined ) {
        bg.clearHistory();
    } else if ( window.localStorage.history.length > 3 ) {
      var history = JSON.parse(window.localStorage.history);
      history = bg.addHashesToColorsInHistory(history);
      bg.color = history[history.length-1];
    } else {
      bg.color = DEFAULT_COLOR;
    }
    // windows support jpeg only
    bg.screenshotFormat = bg.isThisPlatform('windows') ? 'jpeg' : 'png';

    // we have to listen for messages
    bg.messageListener();
    
    // act when tab is changed
    // TODO: call only when needed? this is now used also if picker isn't active
    bg.tabOnChangeListener();

    // TODO: call only when shortcuts enabled now?
    bg.tabOnUpdatedListener();

    // refresh content scripts
    bg.refreshContentScripts();
  },

  // handle finding all tabs and inject where needed
  refreshContentScripts: function() {
    bg.tabs = [];
    bg.findContentScriptTabs();
    window.setTimeout(function() { bg.refreshTabs(); }, 200);
  },

  // find all tabs in all windows and check injected version
  findContentScriptTabs: function() {

    chrome.windows.getAll({'populate':true}, function(windows){
      windows.forEach(function(win) {
        win.tabs.forEach(function(tab) {
          if ( tab != undefined && tab.url.indexOf('http') == 0 && tab.url.indexOf('https://chrome.google.com/webstore') !== 0) {
            bg.tabs.push(tab.id);

            chrome.tabs.sendMessage(tab.id, {type: 'helper-version', tabid: tab.id}, function(response) {
              if ( response.version >= NEED_ED_HELPER_VERSION ) {
                ////console.log("tabid " + tab.id + " is ok. Not injecting.");
                bg.tabs.splice(bg.tabs.indexOf(tab.id), 1);
              }
            });
          }
        });
      });

    });
  },

  // go trough tabs and inject script
  refreshTabs: function() {
    bg.tabs.forEach(function(tabId) {
      ////console.log("tabid " + tabId + " bad. Injecting " + bg.helperFile);
      // TODO insert shortcut only when missing, not when updating
      chrome.tabs.executeScript(tabId, {allFrames: false, file: "inc/shortcut.js"});
      chrome.tabs.executeScript(tabId, {allFrames: false, file: bg.helperFile});
    });
  },

  // in versions before 0.3.0 colors were stored without # hash in front
  // this fixes it
  addHashesToColorsInHistory: function(history) {
      if ( history[0][0] != '#' ) {
          for ( key in history ) {
              history[key] = '#' + history[key];
          }
      }
      window.localStorage.history = JSON.stringify(history);
      return history;
  }
};

document.addEventListener('DOMContentLoaded', function () {
    bg.init()
});

