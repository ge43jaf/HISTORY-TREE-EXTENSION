// Tab History Tree Generator - Background Service Worker
console.log('Tab History Tree Generator: Background script starting...');

class TabHistoryTracker {
    constructor() {
        this.tabHistories = new Map(); // tabId -> {tree, sessionHistory, currentIndex}
        this.tabCreationTimes = new Map(); // tabId -> creation timestamp
        this.init();
    }

    async init() {
        await this.loadStoredData();
        this.setupEventListeners();
        this.initializeExistingTabs();
        console.log('Tab History Tree Generator: Initialized successfully');
    }

    setupEventListeners() {
        // Track tab creation
        chrome.tabs.onCreated.addListener(
            (tab) => this.handleTabCreated(tab)
        );

        // Track tab updates
        chrome.tabs.onUpdated.addListener(
            (tabId, changeInfo, tab) => this.handleTabUpdate(tabId, changeInfo, tab)
        );

        // Track tab activation
        chrome.tabs.onActivated.addListener(
            (activeInfo) => this.handleTabActivation(activeInfo)
        );

        // Clean up when tabs close
        chrome.tabs.onRemoved.addListener(
            (tabId) => this.handleTabClose(tabId)
        );

        // Handle messages from popup
        chrome.runtime.onMessage.addListener(
            (request, sender, sendResponse) => this.handleMessage(request, sender, sendResponse)
        );
    }

    handleTabCreated(tab) {
        // Store the original creation time of the tab
        this.tabCreationTimes.set(tab.id, Date.now());
        console.log(`Tab ${tab.id} created at: ${new Date(this.tabCreationTimes.get(tab.id))}`);
    }

    async initializeExistingTabs() {
        try {
            const tabs = await chrome.tabs.query({});
            const currentTime = Date.now();
            
            for (const tab of tabs) {
                // Set creation time for existing tabs (approximate)
                if (!this.tabCreationTimes.has(tab.id)) {
                    this.tabCreationTimes.set(tab.id, currentTime);
                }
                
                if (tab.url && this.isValidUrl(tab.url)) {
                    await this.initializeTabHistory(tab.id, tab.url, tab.title);
                }
            }
            console.log(`Initialized ${tabs.length} existing tabs`);
        } catch (error) {
            console.error('Error initializing existing tabs:', error);
        }
    }

    async initializeTabHistory(tabId, url, title) {
        if (!this.tabHistories.has(tabId)) {
            const creationTime = this.tabCreationTimes.get(tabId) || Date.now();
            const initialEntry = this.createHistoryEntry(url, title, 'initial', creationTime);
            
            this.tabHistories.set(tabId, {
                sessionHistory: [initialEntry],
                currentIndex: 0,
                tree: this.createTreeNode(initialEntry, 0, true), // Create tree node immediately
                lastUpdated: Date.now()
            });
            console.log(`Initialized tab ${tabId} with URL: ${url}`);
        }
    }

    async handleTabUpdate(tabId, changeInfo, tab) {
        if (changeInfo.status === 'complete' && tab.url && this.isValidUrl(tab.url)) {
            console.log(`Tab ${tabId} updated: ${tab.url}`);
            
            // Get detailed history information from the content script
            const historyInfo = await this.getTabHistoryInfo(tabId);
            await this.updateTabHistory(tabId, tab.url, tab.title, 'navigation', historyInfo);
        }
    }

    async handleTabActivation(activeInfo) {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab.url && this.isValidUrl(tab.url)) {
            const historyInfo = await this.getTabHistoryInfo(tab.id);
            await this.updateTabHistory(tab.id, tab.url, tab.title, 'activation', historyInfo);
        }
    }

    async getTabHistoryInfo(tabId) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: getTabHistoryInfo,
            });
            
            if (results && results[0] && results[0].result) {
                return results[0].result;
            }
        } catch (error) {
            console.log(`Could not get history info from tab ${tabId}:`, error);
        }
        
        return {
            historyLength: 1,
            canGoBack: false,
            canGoForward: false,
            currentState: null
        };
    }

    async updateTabHistory(tabId, url, title, type, historyInfo) {
        let tabHistory = this.tabHistories.get(tabId);
        
        // If no history exists for this tab, initialize it
        if (!tabHistory) {
            const creationTime = this.tabCreationTimes.get(tabId) || Date.now();
            const initialEntry = this.createHistoryEntry(url, title, 'initial', creationTime);
            
            tabHistory = {
                sessionHistory: [initialEntry],
                currentIndex: 0,
                tree: this.createTreeNode(initialEntry, 0, true),
                lastUpdated: Date.now()
            };
            this.tabHistories.set(tabId, tabHistory);
            console.log(`Created new history for tab ${tabId} with URL: ${url}`);
        }

        const { historyLength, canGoBack, canGoForward } = historyInfo;
        
        console.log(`Tab ${tabId} history: length=${historyLength}, back=${canGoBack}, forward=${canGoForward}, currentURL=${url}`);

        // Check if this is a back/forward navigation
        const isBackNavigation = this.detectBackNavigation(tabId, url, historyInfo);
        const isForwardNavigation = this.detectForwardNavigation(tabId, url, historyInfo);

        if (isBackNavigation) {
            this.handleBackNavigation(tabId, url, title);
        } else if (isForwardNavigation) {
            this.handleForwardNavigation(tabId, url, title);
        } else {
            this.handleNewNavigation(tabId, url, title, type, historyInfo);
        }

        tabHistory.lastUpdated = Date.now();
        await this.buildTreeFromSessionHistory(tabId);
        await this.saveToStorage();
    }

    detectBackNavigation(tabId, newUrl, historyInfo) {
        const tabHistory = this.tabHistories.get(tabId);
        if (!tabHistory || tabHistory.sessionHistory.length < 2) return false;

        // Check if we're going back to a previous URL in session history
        const currentIndex = tabHistory.currentIndex;
        if (currentIndex > 0) {
            const previousEntry = tabHistory.sessionHistory[currentIndex - 1];
            const isBack = previousEntry.url === newUrl && historyInfo.canGoBack;
            if (isBack) {
                console.log(`Detected back navigation from ${tabHistory.sessionHistory[currentIndex].url} to ${newUrl}`);
            }
            return isBack;
        }
        return false;
    }

    detectForwardNavigation(tabId, newUrl, historyInfo) {
        const tabHistory = this.tabHistories.get(tabId);
        if (!tabHistory || tabHistory.currentIndex >= tabHistory.sessionHistory.length - 1) return false;

        // Check if we're going forward to a URL that's already in our session history
        const currentIndex = tabHistory.currentIndex;
        if (currentIndex < tabHistory.sessionHistory.length - 1) {
            const nextEntry = tabHistory.sessionHistory[currentIndex + 1];
            const isForward = nextEntry.url === newUrl && historyInfo.canGoForward;
            if (isForward) {
                console.log(`Detected forward navigation from ${tabHistory.sessionHistory[currentIndex].url} to ${newUrl}`);
            }
            return isForward;
        }
        return false;
    }

    handleBackNavigation(tabId, url, title) {
        const tabHistory = this.tabHistories.get(tabId);
        if (!tabHistory) return;

        tabHistory.currentIndex = Math.max(0, tabHistory.currentIndex - 1);
        console.log(`Back navigation to: ${url}, new index: ${tabHistory.currentIndex}`);
    }

    handleForwardNavigation(tabId, url, title) {
        const tabHistory = this.tabHistories.get(tabId);
        if (!tabHistory) return;

        tabHistory.currentIndex = Math.min(
            tabHistory.sessionHistory.length - 1, 
            tabHistory.currentIndex + 1
        );
        console.log(`Forward navigation to: ${url}, new index: ${tabHistory.currentIndex}`);
    }

    handleNewNavigation(tabId, url, title, type, historyInfo) {
        const tabHistory = this.tabHistories.get(tabId);
        if (!tabHistory) return;

        // Check if this is the same as current URL (refresh)
        const currentEntry = tabHistory.sessionHistory[tabHistory.currentIndex];
        if (currentEntry && currentEntry.url === url) {
            console.log(`Same URL navigation (refresh): ${url}`);
            return; // Don't add duplicate entries for refreshes
        }

        // If we're not at the end of history, remove forward history
        if (tabHistory.currentIndex < tabHistory.sessionHistory.length - 1) {
            console.log(`Truncating forward history from index ${tabHistory.currentIndex + 1}`);
            tabHistory.sessionHistory = tabHistory.sessionHistory.slice(0, tabHistory.currentIndex + 1);
        }

        // Add new entry with current timestamp for new navigations
        const newEntry = this.createHistoryEntry(url, title, type, Date.now(), historyInfo);
        tabHistory.sessionHistory.push(newEntry);
        tabHistory.currentIndex = tabHistory.sessionHistory.length - 1;

        console.log(`New navigation: ${url}, history length: ${tabHistory.sessionHistory.length}`);
    }

    async buildTreeFromSessionHistory(tabId) {
        const tabHistory = this.tabHistories.get(tabId);
        if (!tabHistory || tabHistory.sessionHistory.length === 0) {
            console.log(`No session history for tab ${tabId}`);
            return;
        }

        console.log(`Building tree for tab ${tabId} with ${tabHistory.sessionHistory.length} entries`);

        // Start with root node
        const rootEntry = tabHistory.sessionHistory[0];
        const root = this.createTreeNode(rootEntry, 0, tabHistory.currentIndex === 0);

        let currentBranch = [root];

        // Process each subsequent entry in session history
        for (let i = 1; i < tabHistory.sessionHistory.length; i++) {
            const entry = tabHistory.sessionHistory[i];
            const isCurrent = (i === tabHistory.currentIndex);
            
            console.log(`Processing entry ${i}: ${entry.url}, current: ${isCurrent}`);

            // Check if this URL already exists in the current branch (back navigation)
            const existingIndex = currentBranch.findIndex(node => 
                node.entry.url === entry.url
            );

            if (existingIndex !== -1) {
                // Back navigation - truncate branch to the existing node
                console.log(`Back navigation detected to existing node at index ${existingIndex}`);
                currentBranch = currentBranch.slice(0, existingIndex + 1);
                
                // Update current flags
                currentBranch.forEach((node, idx) => {
                    node.isCurrent = (idx === existingIndex && isCurrent);
                });
            } else {
                // New forward navigation - add as child of the last node in current branch
                const parentNode = currentBranch[currentBranch.length - 1];
                const newNode = this.createTreeNode(entry, currentBranch.length, isCurrent);
                
                if (!parentNode.children) {
                    parentNode.children = [];
                }
                
                parentNode.children.push(newNode);
                currentBranch.push(newNode);
                console.log(`Added new node as child of ${parentNode.entry.url}`);
            }
        }

        tabHistory.tree = root;
        console.log(`Tree built successfully for tab ${tabId}`);
    }

    createTreeNode(entry, level, isCurrent = false) {
        return {
            entry: entry,
            children: [],
            level: level,
            isCurrent: isCurrent
        };
    }

    createHistoryEntry(url, title, type, timestamp, historyInfo = {}) {
        return {
            url: url,
            title: title || this.getDomainFromUrl(url),
            timestamp: timestamp || Date.now(),
            type: type,
            historyLength: historyInfo.historyLength || 1,
            canGoBack: historyInfo.canGoBack || false,
            canGoForward: historyInfo.canGoForward || false,
            state: historyInfo.currentState || null
        };
    }

    getDomainFromUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch (e) {
            return url;
        }
    }

    getAllTabTrees() {
        const trees = [];
        
        for (const [tabId, tabHistory] of this.tabHistories) {
            console.log(`Processing tab ${tabId}:`, {
                hasTree: !!tabHistory.tree,
                sessionLength: tabHistory.sessionHistory?.length,
                currentIndex: tabHistory.currentIndex
            });

            const treeData = {
                tabId: tabId,
                tree: tabHistory.tree,
                sessionHistory: tabHistory.sessionHistory || [],
                currentIndex: tabHistory.currentIndex || 0,
                lastUpdated: tabHistory.lastUpdated,
                creationTime: this.tabCreationTimes.get(tabId) || tabHistory.lastUpdated
            };

            trees.push(treeData);
        }

        // Sort by last updated (most recent first)
        trees.sort((a, b) => b.lastUpdated - a.lastUpdated);
        
        console.log(`Returning ${trees.length} tab trees`);
        return trees;
    }

    handleTabClose(tabId) {
        this.tabHistories.delete(tabId);
        this.tabCreationTimes.delete(tabId);
        console.log(`Cleaned up history for tab ${tabId}`);
    }

    handleMessage(request, sender, sendResponse) {
        console.log('Received message:', request.action);
        
        switch (request.action) {
            case 'getAllTabTrees':
                const tabTrees = this.getAllTabTrees();
                sendResponse({
                    success: true,
                    tabTrees: tabTrees
                });
                break;

            case 'clearHistory':
                this.tabHistories.clear();
                this.tabCreationTimes.clear();
                this.saveToStorage();
                sendResponse({ success: true });
                break;

            case 'getStatus':
                sendResponse({
                    success: true,
                    trackedTabs: this.tabHistories.size,
                    totalSessionEntries: Array.from(this.tabHistories.values())
                        .reduce((sum, history) => sum + history.sessionHistory.length, 0)
                });
                break;

            case 'refreshTabHistory':
                if (request.tabId) {
                    this.buildTreeFromSessionHistory(request.tabId);
                    const tabTree = this.tabHistories.get(request.tabId);
                    sendResponse({
                        success: true,
                        tree: tabTree ? {
                            tabId: request.tabId,
                            tree: tabTree.tree,
                            sessionHistory: tabTree.sessionHistory,
                            currentIndex: tabTree.currentIndex
                        } : null
                    });
                }
                break;

            case 'debugInfo':
                const debugInfo = {
                    tabHistories: Array.from(this.tabHistories.entries()).map(([id, history]) => ({
                        tabId: id,
                        sessionLength: history.sessionHistory?.length,
                        hasTree: !!history.tree,
                        currentIndex: history.currentIndex,
                        tree: history.tree ? this.simplifyTreeForDebug(history.tree) : null
                    })),
                    totalTabs: this.tabHistories.size
                };
                sendResponse({ success: true, debugInfo: debugInfo });
                break;

            default:
                sendResponse({ success: false, error: 'Unknown action' });
        }
        
        return true;
    }

    simplifyTreeForDebug(node) {
        if (!node) return null;
        return {
            url: node.entry?.url,
            level: node.level,
            isCurrent: node.isCurrent,
            children: node.children ? node.children.map(child => this.simplifyTreeForDebug(child)) : []
        };
    }

    isValidUrl(url) {
        return url && (url.startsWith('http:') || url.startsWith('https:'));
    }

    async saveToStorage() {
        try {
            const data = {
                tabHistories: Array.from(this.tabHistories.entries()),
                tabCreationTimes: Array.from(this.tabCreationTimes.entries()),
                lastSaved: Date.now()
            };
            await chrome.storage.local.set({ historyTrackerData: data });
        } catch (error) {
            console.error('Failed to save data:', error);
        }
    }

    async loadStoredData() {
        try {
            const result = await chrome.storage.local.get(['historyTrackerData']);
            if (result.historyTrackerData) {
                const data = result.historyTrackerData;
                this.tabHistories = new Map(data.tabHistories || []);
                this.tabCreationTimes = new Map(data.tabCreationTimes || []);
                console.log(`Loaded ${this.tabHistories.size} tab histories from storage`);
                
                // Rebuild trees for all loaded histories
                for (const [tabId] of this.tabHistories) {
                    await this.buildTreeFromSessionHistory(tabId);
                }
            }
        } catch (error) {
            console.error('Failed to load data:', error);
        }
    }
}

// Content script function to get history information
function getTabHistoryInfo() {
    // Function to check if we can go back/forward
    function canNavigate() {
        try {
            // Try to access history state to determine navigation capabilities
            return {
                canGoBack: history.length > 1 && typeof history.back === 'function',
                canGoForward: history.length > 1 && typeof history.forward === 'function'
            };
        } catch (e) {
            return { canGoBack: false, canGoForward: false };
        }
    }

    const navigation = canNavigate();
    
    return {
        historyLength: history.length,
        canGoBack: navigation.canGoBack,
        canGoForward: navigation.canGoForward,
        currentState: history.state,
        currentUrl: window.location.href,
        referrer: document.referrer,
        timestamp: Date.now()
    };
}

// Initialize the tracker
const tracker = new TabHistoryTracker();