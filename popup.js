class TabHistoryPopup {
    constructor() {
        this.tabTrees = [];
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadTabTrees();
        this.checkStatus();
    }

    bindEvents() {
        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.loadTabTrees();
        });

        document.getElementById('clearBtn').addEventListener('click', () => {
            this.clearAllHistory();
        });

        document.getElementById('clearClosedBtn').addEventListener('click', () => {
            this.clearClosedTabs();
        });

        document.getElementById('exportBtn').addEventListener('click', () => {
            this.exportData();
        });
    }

    async loadTabTrees() {
        this.showLoading();
        
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getAllTabTrees' });
            console.log('Received response:', response);
            
            if (response && response.success) {
                this.tabTrees = response.tabTrees || [];
                console.log('Tab trees data:', this.tabTrees);
                this.displayTabTrees();
                this.updateStats();
            } else {
                this.showError('Failed to load tab trees: ' + (response.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error loading tab trees:', error);
            this.showError('Error communicating with extension: ' + error.message);
        }
    }

    async getCurrentTab() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            return tab;
        } catch (error) {
            console.error('Error getting current tab:', error);
            return null;
        }
    }

    async displayTabTrees() {
        const container = document.getElementById('tabsContainer');
        const currentTab = await this.getCurrentTab();
        
        console.log('Displaying tab trees:', this.tabTrees);
        
        if (!this.tabTrees || this.tabTrees.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>No Tab History Available</h3>
                    <p>Browse the web to see history trees for each tab.</p>
                    <p><small>Try navigating to different pages and using back/forward buttons.</small></p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.tabTrees.map(tabTree => 
            this.createTabSection(tabTree, currentTab)
        ).join('');

        // Add event listeners for refresh buttons
        this.bindTabRefreshButtons();
        this.bindDebugButtons();
    }

    createTabSection(tabTree, currentTab) {
        const isCurrentTab = currentTab && tabTree.tabId === currentTab.id;
        const isClosed = tabTree.isClosed || false;
        
        let tabTitle = `Tab ${tabTree.tabId}`;
        if (isCurrentTab) tabTitle += ' (Current)';
        if (isClosed) tabTitle += ' (Closed)';
        
        const lastUpdated = new Date(tabTree.lastUpdated).toLocaleString();
        const creationTime = new Date(tabTree.creationTime).toLocaleString();
        const sessionLength = tabTree.sessionHistory ? tabTree.sessionHistory.length : 0;
        
        let treeContent = '';
        if (tabTree.tree && tabTree.tree.entry) {
            treeContent = this.renderTreeNode(tabTree.tree, 0);
        } else if (tabTree.sessionHistory && tabTree.sessionHistory.length > 0) {
            // If we have session history but no tree, show the linear history
            treeContent = this.renderLinearHistory(tabTree);
        } else {
            treeContent = '<div class="empty-state">No history data available</div>';
        }
        
        return `
            <div class="tab-section ${isCurrentTab ? 'current' : ''} ${isClosed ? 'closed' : ''}">
                <div class="tab-header">
                    <span>${tabTitle}</span>
                    <span class="tab-stats">
                        <span>Created: ${creationTime}</span>
                        ${isClosed ? `<span>Closed: ${new Date(tabTree.closedAt).toLocaleString()}</span>` : ''}
                        <span>Session: ${sessionLength} entries</span>
                        <span>Current: ${(tabTree.currentIndex || 0) + 1}/${sessionLength}</span>
                        ${!isClosed ? `<button class="tab-refresh-btn" data-tab-id="${tabTree.tabId}">Refresh</button>` : ''}
                        <button class="debug-btn" data-tab-id="${tabTree.tabId}">Debug</button>
                    </span>
                </div>
                <div class="tree-container">
                    ${treeContent}
                    ${this.renderSessionHistory(tabTree)}
                </div>
            </div>
        `;
    }

    renderTreeNode(node, level) {
        if (!node || !node.entry) {
            console.error('Invalid node in renderTreeNode:', node);
            return '<div class="error">Invalid node data</div>';
        }
        
        const childrenHtml = (node.children || []).map(child => 
            this.renderTreeNode(child, level + 1)
        ).join('');
        
        const nodeType = this.getNodeTypeLabel(node.entry.type);
        const historyInfo = node.entry;
        const originalTime = new Date(node.entry.timestamp).toLocaleString();
        const title = node.entry.title || this.getDomainFromUrl(node.entry.url);
        
        return `
            <div class="tree-node tree-level-${level}">
                <div class="tree-content ${node.isCurrent ? 'current' : ''}">
                    <a href="${node.entry.url}" target="_blank" class="url" title="${node.entry.url}">
                        ${title}
                    </a>
                    <div class="meta">
                        <span class="timestamp" title="Original access time">${originalTime}</span>
                        <span class="nav-type">${nodeType}</span>
                    </div>
                    <div class="history-info">
                        <span class="history-badge">Level: ${level}</span>
                        <span class="history-badge">Children: ${(node.children || []).length}</span>
                        <span class="history-badge">History Length: ${historyInfo.historyLength}</span>
                        ${historyInfo.canGoBack ? '<span class="history-badge">Can Go Back</span>' : ''}
                        ${historyInfo.canGoForward ? '<span class="history-badge">Can Go Forward</span>' : ''}
                    </div>
                </div>
                ${childrenHtml}
            </div>
        `;
    }

    renderLinearHistory(tabTree) {
        if (!tabTree.sessionHistory || tabTree.sessionHistory.length === 0) {
            return '<div class="empty-state">No session history available</div>';
        }

        return `
            <div style="margin-bottom: 15px;">
                <div style="font-weight: bold; margin-bottom: 10px; color: #666;">Linear History (Tree building in progress):</div>
                ${tabTree.sessionHistory.map((entry, index) => {
                    const originalTime = new Date(entry.timestamp).toLocaleString();
                    const title = entry.title || this.getDomainFromUrl(entry.url);
                    const isCurrent = index === tabTree.currentIndex;
                    
                    return `
                        <div style="padding: 8px; margin: 2px 0; border: 1px solid #e0e0e0; border-radius: 4px; background: ${isCurrent ? '#e8f0fe' : 'white'}; ${isCurrent ? 'border-color: #4285f4; font-weight: bold;' : ''}">
                            <div><strong>${index + 1}. ${title}</strong></div>
                            <div style="font-size: 10px; color: #666; word-break: break-all;">${entry.url}</div>
                            <div style="font-size: 9px; color: #888;">${originalTime} • ${this.getNodeTypeLabel(entry.type)}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    renderSessionHistory(tabTree) {
        if (!tabTree.sessionHistory || tabTree.sessionHistory.length === 0) return '';
        
        return `
            <div style="margin-top: 20px; padding: 10px; background: #f8f9fa; border-radius: 6px;">
                <div style="font-weight: bold; margin-bottom: 10px; font-size: 12px;">
                    Raw Session History (${tabTree.sessionHistory.length} entries):
                </div>
                <div style="font-size: 11px; line-height: 1.4; max-height: 150px; overflow-y: auto;">
                    ${tabTree.sessionHistory.map((entry, index) => {
                        const originalTime = new Date(entry.timestamp).toLocaleString();
                        const title = entry.title || this.getDomainFromUrl(entry.url);
                        return `
                            <div style="padding: 2px 0; ${index === tabTree.currentIndex ? 'font-weight: bold; color: #4285f4;' : ''}">
                                ${index + 1}. ${title} 
                                <span style="color: #666;" title="Original access time">(${originalTime})</span>
                            </div>`;
                    }).join('')}
                </div>
            </div>
        `;
    }

    bindTabRefreshButtons() {
        const refreshButtons = document.querySelectorAll('.tab-refresh-btn');
        refreshButtons.forEach(button => {
            button.addEventListener('click', async (e) => {
                const tabId = parseInt(e.target.dataset.tabId);
                e.target.textContent = 'Refreshing...';
                e.target.disabled = true;
                
                try {
                    const response = await chrome.runtime.sendMessage({ 
                        action: 'refreshTabHistory', 
                        tabId: tabId 
                    });
                    
                    if (response && response.success) {
                        // Reload all trees to get updated data
                        await this.loadTabTrees();
                    }
                } catch (error) {
                    console.error('Error refreshing tab:', error);
                } finally {
                    e.target.textContent = 'Refresh';
                    e.target.disabled = false;
                }
            });
        });
    }

    bindDebugButtons() {
        const debugButtons = document.querySelectorAll('.debug-btn');
        debugButtons.forEach(button => {
            button.addEventListener('click', async (e) => {
                const tabId = parseInt(e.target.dataset.tabId);
                await this.debugTab(tabId);
            });
        });
    }

    async debugTab(tabId) {
        try {
            const response = await chrome.runtime.sendMessage({ 
                action: 'debugInfo'
            });
            
            if (response && response.success) {
                console.log('Debug info for all tabs:', response.debugInfo);
                // Find the specific tab in debug info
                const tabDebugInfo = response.debugInfo.activeTabs.find(tab => tab.tabId === tabId) || 
                                   response.debugInfo.closedTabs.find(tab => tab.tabId === tabId);
                if (tabDebugInfo) {
                    console.log(`Debug info for tab ${tabId}:`, tabDebugInfo);
                    alert(`Check console for debug info for tab ${tabId}`);
                } else {
                    alert(`No debug info found for tab ${tabId}`);
                }
            }
        } catch (error) {
            console.error('Error getting debug info:', error);
            alert('Error getting debug info');
        }
    }

    async clearClosedTabs() {
        if (!confirm('Are you sure you want to clear all closed tab histories? This cannot be undone.')) {
            return;
        }

        try {
            const response = await chrome.runtime.sendMessage({ action: 'clearClosedTabs' });
            
            if (response && response.success) {
                await this.loadTabTrees(); // Reload to reflect changes
                this.checkStatus();
                alert('Closed tab histories cleared successfully');
            } else {
                alert('Failed to clear closed tab histories');
            }
        } catch (error) {
            console.error('Error clearing closed tabs:', error);
            alert('Error clearing closed tab histories');
        }
    }

    getNodeTypeLabel(type) {
        const labels = {
            'initial': 'Initial',
            'root': 'Root',
            'navigation': 'Navigation',
            'activation': 'Activation',
            'back': 'Back',
            'forward': 'Forward'
        };
        return labels[type] || type;
    }

    getDomainFromUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch (e) {
            return url;
        }
    }

    async checkStatus() {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getStatus' });
            if (response && response.success) {
                document.getElementById('totalTabs').textContent = 
                    `${response.trackedTabs} total tabs (${response.activeTabs} active, ${response.closedTabs} closed)`;
                document.getElementById('status').textContent = 
                    `${response.totalSessionEntries} total entries`;
            }
        } catch (error) {
            console.error('Error checking status:', error);
        }
    }

    updateStats() {
        const activeTabs = this.tabTrees.filter(tab => !tab.isClosed).length;
        const closedTabs = this.tabTrees.filter(tab => tab.isClosed).length;
        const totalEntries = this.tabTrees.reduce((sum, tab) => 
            sum + (tab.sessionHistory ? tab.sessionHistory.length : 0), 0
        );
        
        document.getElementById('totalTabs').textContent = 
            `${this.tabTrees.length} total tabs (${activeTabs} active, ${closedTabs} closed)`;
        document.getElementById('status').textContent = 
            `${totalEntries} total entries`;
    }

    showLoading() {
        document.getElementById('tabsContainer').innerHTML = `
            <div class="loading">Loading tab history trees...</div>
        `;
    }

    showError(message) {
        document.getElementById('tabsContainer').innerHTML = `
            <div class="error">${message}</div>
        `;
    }

    async clearAllHistory() {
        if (!confirm('Are you sure you want to clear ALL tab history (both active and closed tabs)? This cannot be undone.')) {
            return;
        }

        try {
            const response = await chrome.runtime.sendMessage({ action: 'clearHistory' });
            
            if (response && response.success) {
                this.tabTrees = [];
                this.displayTabTrees();
                this.updateStats();
                this.checkStatus();
            } else {
                alert('Failed to clear history');
            }
        } catch (error) {
            console.error('Error clearing history:', error);
            alert('Error clearing history');
        }
    }

    async exportData() {
        try {
            const data = {
                tabTrees: this.tabTrees,
                exportTime: new Date().toISOString(),
                version: '1.0'
            };
            
            const blob = new Blob([JSON.stringify(data, null, 2)], { 
                type: 'application/json' 
            });
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `tab-history-export-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
        } catch (error) {
            console.error('Error exporting data:', error);
            alert('Error exporting data');
        }
    }

    truncateUrl(url, maxLength = 70) {
        if (url.length <= maxLength) return url;
        return url.substring(0, maxLength) + '...';
    }

    formatTime(timestamp) {
        return new Date(timestamp).toLocaleTimeString();
    }
}

// Initialize the popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new TabHistoryPopup();
});