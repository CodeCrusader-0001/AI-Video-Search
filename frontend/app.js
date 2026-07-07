// AURA Web App JS Client Core Engine - Premium AI SaaS Workspace Redesign

const API_BASE = ""; // Relative URL (FastAPI host)
let AUTH_TOKEN = null;
let videosInventory = [];
let recentQueries = [];
let selectedVideoContextId = ""; // Current active video filter context
let activeCommandPaletteIndex = 0; // Tracking selected item in Command Palette

// Global reference of search matches to allow shift + arrow seeks
let activeSearchMatches = [];
let currentSearchMatchIndex = 0;

// DOM Element Registry
const elements = {
    videoInventoryBody: document.getElementById("video-inventory-body"),
    searchBtn: document.getElementById("search-btn"),
    searchQueryInput: document.getElementById("search-query-input"),
    searchVideoFilter: document.getElementById("search-video-filter"),
    searchResultsList: document.getElementById("search-results-list"),
    resultsCountText: document.getElementById("results-count-text"),
    resultsLatencyText: document.getElementById("results-latency-text"),
    
    // Ingest Panels
    uploadContainer: document.getElementById("upload-container"),
    processingContainer: document.getElementById("processing-container"),
    checklistPercentage: document.getElementById("checklist-percentage-label"),
    globalLoaderBar: document.getElementById("global-loader-bar"),
    
    // Ingestion Telemetry
    telemetryElapsed: document.getElementById("telemetry-elapsed"),
    telemetryScenes: document.getElementById("telemetry-scenes"),
    telemetryFeatures: document.getElementById("telemetry-features"),
    
    // Inline Player
    inlinePlayerWrapper: document.getElementById("inline-player-wrapper"),
    videoPlayer: document.getElementById("main-video-player"),
    playerVideoTitle: document.getElementById("inline-player-video-title"),
    playerPlaybackSpeed: document.getElementById("player-playback-speed"),
    playerLoopSceneCheck: document.getElementById("player-loop-scene-check"),
    
    // Details Inspector Panel (Right column)
    detailsEmpty: document.getElementById("details-content-empty"),
    detailsActive: document.getElementById("details-content-active"),
    detailsFrameImg: document.getElementById("details-frame-img"),
    playerScoreBadge: document.getElementById("player-score-badge"),
    playerTimestampBadge: document.getElementById("player-timestamp-badge"),
    playerCaptionText: document.getElementById("player-caption-text"),
    playerSpeechText: document.getElementById("player-speech-text"),
    playerObjectsContainer: document.getElementById("player-objects-container"),
    playerAiExplanation: document.getElementById("player-ai-explanation"),
    
    // Upload elements
    dropZone: document.getElementById("upload-drop-zone"),
    fileInput: document.getElementById("file-input-hidden"),
    uploadTitleInput: document.getElementById("upload-title-input"),
    uploadSubmitBtn: document.getElementById("upload-submit-btn"),
    uploadProgressBox: document.getElementById("upload-progress-box"),
    uploadProgressFill: document.getElementById("upload-progress-fill"),
    uploadPercentageLabel: document.getElementById("upload-percentage-label"),
    uploadFilenameLabel: document.getElementById("upload-filename-label"),
    uploadStatusText: document.getElementById("upload-status-text"),
    
    // Other Containers
    recentQueriesList: document.getElementById("recent-searches-list"),
    hardwareTarget: document.getElementById("analytics-hardware-target"),
    contextMenu: document.getElementById("video-context-menu"),
    commandPalette: document.getElementById("command-palette-modal"),
    cmdPaletteInput: document.getElementById("cmd-palette-input"),
    cmdPaletteResults: document.getElementById("cmd-palette-results-list"),
    settingsModal: document.getElementById("settings-modal"),
    profileDropdown: document.getElementById("profile-dropdown")
};

// Tracking ingestion metrics timer
let activeIngestionStartTime = null;
let activeIngestionTimer = null;

// Track bounds for looped scene enforcement
let loopSceneStart = 0;
let loopSceneEnd = 0;

// --- Application Bootstrapping ---
document.addEventListener("DOMContentLoaded", async () => {
    setupUploadHandlers();
    setupSearchHandlers();
    setupPromptSuggestions();
    setupKeyboardHotkeys();
    loadRecentQueries();
    
    // Auto-authenticate default guest profile to acquire JWT tokens
    const connected = await authenticateDeveloper();
    if (connected) {
        updateConnectionStatus(true);
        app.refreshDashboard();
    } else {
        updateConnectionStatus(false, "Server Offline");
    }
});

function updateConnectionStatus(isOnline, text = "Service Connected") {
    const badge = document.getElementById("connection-badge");
    if (badge) {
        const label = badge.querySelector(".badge-text");
        if (isOnline) {
            badge.classList.remove("offline");
            label.innerText = text;
        } else {
            badge.classList.add("offline");
            label.innerText = text;
        }
    }
}

// --- Auth Manager (Zero-Friction JWT Boot) ---
async function authenticateDeveloper() {
    const devEmail = "guest@aura.ai";
    const devPassword = "aura_developer_password_2026";
    
    try {
        let response = await fetch(`${API_BASE}/api/v1/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ username: devEmail, password: devPassword })
        });
        
        if (response.status === 400) {
            // Account might not exist yet, attempt registration
            const registerResponse = await fetch(`${API_BASE}/api/v1/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: devEmail, password: devPassword })
            });
            
            if (registerResponse.ok) {
                response = await fetch(`${API_BASE}/api/v1/auth/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({ username: devEmail, password: devPassword })
                });
            }
        }
        
        if (response.ok) {
            const data = await response.json();
            AUTH_TOKEN = data.access_token;
            console.log("Auto-authentication complete. JWT acquired.");
            return true;
        }
    } catch (err) {
        console.error("Connection to backend server failed:", err);
    }
    return false;
}

// Helper to bundle headers
function getHeaders() {
    return {
        "Authorization": `Bearer ${AUTH_TOKEN}`
    };
}

// --- Dynamic Ingestion Telemetry Helpers ---
function startIngestionTimer() {
    if (activeIngestionTimer) clearInterval(activeIngestionTimer);
    activeIngestionStartTime = Date.now();
    activeIngestionTimer = setInterval(() => {
        if (!activeIngestionStartTime) return;
        const diffSec = Math.floor((Date.now() - activeIngestionStartTime) / 1000);
        elements.telemetryElapsed.innerText = `~${diffSec}s`;
    }, 1000);
}

function stopIngestionTimer() {
    if (activeIngestionTimer) {
        clearInterval(activeIngestionTimer);
        activeIngestionTimer = null;
    }
    activeIngestionStartTime = null;
}

// --- Keyboard Hotkey Core Listeners ---
function setupKeyboardHotkeys() {
    document.addEventListener("keydown", (e) => {
        // Cmd+K or Ctrl+K to open Command Palette
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            app.toggleCommandPalette();
            return;
        }

        // Focus search query input when pressing /
        if (e.key === "/" && document.activeElement !== elements.searchQueryInput && document.activeElement !== elements.cmdPaletteInput && document.activeElement.tagName !== "INPUT") {
            e.preventDefault();
            elements.searchQueryInput.focus();
            elements.searchQueryInput.select();
            return;
        }

        // Escape closes modals, palettes, and dropdowns
        if (e.key === "Escape") {
            app.closeCommandPalette();
            app.closeSettings();
            app.closeInlinePlayer();
            elements.profileDropdown.classList.remove("active");
            elements.contextMenu.classList.remove("active");
            return;
        }

        // Space bar plays/pauses active video player
        if (e.key === " " && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "SELECT") {
            e.preventDefault();
            if (elements.inlinePlayerWrapper.style.display !== "none") {
                if (elements.videoPlayer.paused) {
                    elements.videoPlayer.play();
                    app.showToast("Playback resumed", "info");
                } else {
                    elements.videoPlayer.pause();
                    app.showToast("Playback paused", "info");
                }
            }
            return;
        }

        // ArrowLeft / ArrowRight to step frame-by-frame
        if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.shiftKey && document.activeElement.tagName !== "INPUT") {
            if (elements.inlinePlayerWrapper.style.display !== "none") {
                e.preventDefault();
                const frameTime = 1 / 30.0;
                if (e.key === "ArrowLeft") {
                    elements.videoPlayer.currentTime = Math.max(0, elements.videoPlayer.currentTime - frameTime);
                } else {
                    elements.videoPlayer.currentTime = Math.min(elements.videoPlayer.duration, elements.videoPlayer.currentTime + frameTime);
                }
            }
            return;
        }

        // Shift + ArrowLeft / ArrowRight to jump seek matches
        if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.shiftKey && document.activeElement.tagName !== "INPUT") {
            if (elements.inlinePlayerWrapper.style.display !== "none" && activeSearchMatches.length > 0) {
                e.preventDefault();
                if (e.key === "ArrowLeft") {
                    app.seekSceneMatch(-1);
                } else {
                    app.seekSceneMatch(1);
                }
            }
            return;
        }
    });

    // Command palette key navigation
    elements.cmdPaletteInput.addEventListener("keydown", (e) => {
        const items = elements.cmdPaletteResults.querySelectorAll(".cmd-item");
        if (items.length === 0) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            items[activeCommandPaletteIndex].classList.remove("selected");
            activeCommandPaletteIndex = (activeCommandPaletteIndex + 1) % items.length;
            items[activeCommandPaletteIndex].classList.add("selected");
            items[activeCommandPaletteIndex].scrollIntoView({ block: 'nearest' });
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            items[activeCommandPaletteIndex].classList.remove("selected");
            activeCommandPaletteIndex = (activeCommandPaletteIndex - 1 + items.length) % items.length;
            items[activeCommandPaletteIndex].classList.add("selected");
            items[activeCommandPaletteIndex].scrollIntoView({ block: 'nearest' });
        } else if (e.key === "Enter") {
            e.preventDefault();
            items[activeCommandPaletteIndex].click();
        }
    });

    document.addEventListener("click", () => {
        elements.contextMenu.classList.remove("active");
    });
}

// --- Core Application Logic ---
const app = {
    // Refresh Inventory & Metrics
    async refreshDashboard() {
        if (!AUTH_TOKEN) return;
        
        try {
            const response = await fetch(`${API_BASE}/api/v1/videos`, { headers: getHeaders() });
            if (!response.ok) throw new Error("Failed to load inventory");
            
            const videos = await response.json();
            videosInventory = videos;
            
            elements.videoInventoryBody.innerHTML = "";
            
            if (videos.length === 0) {
                elements.videoInventoryBody.innerHTML = `
                    <div class="library-empty">
                        No videos found in library.<br>Upload one in the search studio!
                    </div>
                `;
                app.showEmptyState("no-videos");
            } else {
                videos.forEach(v => {
                    const durationText = v.duration_seconds > 0 ? `${Math.floor(v.duration_seconds / 60)}m ${v.duration_seconds % 60}s` : "--:--";
                    const createdDate = new Date(v.created_at).toLocaleDateString(undefined, {
                        month: 'short', day: 'numeric'
                    });
                    
                    const statusClass = v.status.toLowerCase();
                    const statusText = v.status;
                    
                    const card = document.createElement("div");
                    card.className = `video-library-card ${v.id === selectedVideoContextId ? 'active' : ''}`;
                    card.innerHTML = `
                        <div class="card-title-row">
                            <span class="card-video-title" title="${v.title}">${v.title}</span>
                        </div>
                        <div class="card-footer-row">
                            <span class="card-date">${createdDate} &bull; ${durationText}</span>
                            <span class="library-status-indicator ${statusClass}">
                                <span class="indicator-dot"></span>
                                <span>${statusText}</span>
                            </span>
                        </div>
                        ${v.status === 'PROCESSING' || v.status === 'PENDING' ? `
                        <div class="card-progress-bar">
                            <div class="card-progress-fill" style="width: ${v.progress || 0}%"></div>
                        </div>
                        <div class="card-progress-text">${v.progress || 0}% - ${v.progress_message || 'Initializing...'}</div>
                        ` : ''}
                        <button class="btn-card-context" title="Context Actions">
                            <i data-lucide="more-horizontal"></i>
                        </button>
                        <button class="btn-card-delete-direct" title="Purge Video">
                            <i data-lucide="trash-2"></i>
                        </button>
                    `;
                    
                    card.addEventListener("click", (e) => {
                        if (e.target.closest(".btn-card-context") || e.target.closest(".btn-card-delete-direct")) return;
                        app.selectVideoContext(v.id);
                    });
                    
                    const ctxBtn = card.querySelector(".btn-card-context");
                    ctxBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        app.openContextMenu(e, v.id);
                    });
                    
                    const delBtn = card.querySelector(".btn-card-delete-direct");
                    delBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        app.deleteVideo(v.id);
                    });
                    
                    elements.videoInventoryBody.appendChild(card);
                });
                
                app.populateVideoFilterDropdown();
            }

            app.refreshAnalytics();
            
            const hasActiveJobs = videos.some(v => v.status === "PROCESSING" || v.status === "PENDING");
            if (hasActiveJobs) {
                elements.globalLoaderBar.style.width = "65%";
                elements.globalLoaderBar.classList.add("active");
                startIngestionTimer();
                
                const activeVideo = videos.find(v => v.status === "PROCESSING" || v.status === "PENDING");
                if (activeVideo && (selectedVideoContextId === "" || selectedVideoContextId === activeVideo.id)) {
                    if (selectedVideoContextId === "") {
                        app.selectVideoContext(activeVideo.id);
                    } else {
                        app.renderLiveProcessingChecklist(activeVideo);
                    }
                }
                
                if (!app.pollingTimer) {
                    app.pollingTimer = setInterval(() => {
                        app.refreshDashboard();
                    }, 3000);
                }
            } else {
                elements.globalLoaderBar.style.width = "0%";
                elements.globalLoaderBar.classList.remove("active");
                stopIngestionTimer();
                
                if (app.pollingTimer) {
                    clearInterval(app.pollingTimer);
                    app.pollingTimer = null;
                }
                
                if (selectedVideoContextId !== "") {
                    const currentVid = videos.find(v => v.id === selectedVideoContextId);
                    if (currentVid && currentVid.status === "COMPLETED") {
                        elements.uploadContainer.style.display = "block";
                        elements.processingContainer.style.display = "none";
                        elements.searchQueryInput.removeAttribute("disabled");
                        elements.searchBtn.removeAttribute("disabled");
                        elements.searchQueryInput.setAttribute("placeholder", "Search matching moments: 'man dancing', 'red shirt', 'cat jumping'...");
                    }
                }
            }

            if (window.lucide) {
                window.lucide.createIcons();
            }
            
        } catch (err) {
            console.error("Dashboard refresh error:", err);
        }
    },

    selectVideoContext(videoId) {
        selectedVideoContextId = videoId;
        document.querySelectorAll(".video-library-card").forEach(c => c.classList.remove("active"));
        app.refreshDashboard();
        
        elements.searchVideoFilter.value = videoId;
        
        const video = videosInventory.find(v => v.id === videoId);
        if (video) {
            if (video.status === "PROCESSING" || video.status === "PENDING") {
                elements.uploadContainer.style.display = "none";
                elements.processingContainer.style.display = "block";
                app.renderLiveProcessingChecklist(video);
                
                elements.searchQueryInput.setAttribute("disabled", "true");
                elements.searchBtn.setAttribute("disabled", "true");
                elements.searchQueryInput.setAttribute("placeholder", "This video is still preparing its AI search index.");
                app.showEmptyState("processing");
            } else if (video.status === "FAILED") {
                elements.uploadContainer.style.display = "block";
                elements.processingContainer.style.display = "none";
                elements.searchQueryInput.setAttribute("disabled", "true");
                elements.searchBtn.setAttribute("disabled", "true");
                elements.searchQueryInput.setAttribute("placeholder", "AI Indexing failed for this video.");
                app.showEmptyState("failed");
                app.showToast("Analysis failed: " + (video.progress_message || "Ingest error"), "error");
            } else {
                elements.uploadContainer.style.display = "block";
                elements.processingContainer.style.display = "none";
                elements.searchQueryInput.removeAttribute("disabled");
                elements.searchBtn.removeAttribute("disabled");
                elements.searchQueryInput.setAttribute("placeholder", `Search inside: "${video.title}"...`);
                app.showEmptyState("ready");
            }
        }
    },

    renderLiveProcessingChecklist(video) {
        const progress = video.progress || 0;
        elements.checklistPercentage.innerText = `${progress}%`;
        
        const fillEl = document.getElementById("checklist-progress-fill");
        if (fillEl) {
            fillEl.style.width = `${progress}%`;
        }
        
        let estimatedCuts = Math.floor(progress * 1.3) + " cuts";
        let estimatedVectors = Math.floor(progress * 1.3) + " vectors";
        if (video.status === "COMPLETED") {
            estimatedCuts = "132 cuts";
            estimatedVectors = "132 vectors";
        }
        elements.telemetryScenes.innerText = estimatedCuts;
        elements.telemetryFeatures.innerText = estimatedVectors;
        
        const steps = {
            upload: document.getElementById("step-upload"),
            cut: document.getElementById("step-cut"),
            transcribe: document.getElementById("step-transcribe"),
            vision: document.getElementById("step-vision"),
            index: document.getElementById("step-index")
        };
        
        app.updateStepStyle(steps.upload, "completed");
        
        if (progress >= 20) {
            app.updateStepStyle(steps.cut, "completed");
        } else if (progress >= 10) {
            app.updateStepStyle(steps.cut, "active");
        } else {
            app.updateStepStyle(steps.cut, "pending");
        }
        
        if (progress >= 95) {
            app.updateStepStyle(steps.vision, "completed");
        } else if (progress >= 20) {
            app.updateStepStyle(steps.vision, "active");
        } else {
            app.updateStepStyle(steps.vision, "pending");
        }
        
        if (progress >= 98) {
            app.updateStepStyle(steps.transcribe, "completed");
        } else if (progress >= 95) {
            app.updateStepStyle(steps.transcribe, "active");
        } else {
            app.updateStepStyle(steps.transcribe, "pending");
        }
        
        if (video.status === "COMPLETED") {
            app.updateStepStyle(steps.index, "completed");
            app.showToast(`AI index ready: "${video.title}"`, "success");
        } else if (progress >= 98) {
            app.updateStepStyle(steps.index, "active");
        } else {
            app.updateStepStyle(steps.index, "pending");
        }
        
        if (window.lucide) {
            window.lucide.createIcons();
        }
    },

    updateStepStyle(stepEl, state) {
        if (!stepEl) return;
        stepEl.classList.remove("completed", "active", "pending");
        stepEl.classList.add(state);
        
        const iconContainer = stepEl.querySelector(".step-icon");
        if (state === "completed") {
            iconContainer.innerHTML = `<i data-lucide="check-circle-2"></i>`;
        } else if (state === "active") {
            iconContainer.innerHTML = `<i data-lucide="loader-2" class="animate-spin"></i>`;
        } else {
            iconContainer.innerHTML = `<i data-lucide="circle"></i>`;
        }
    },

    showEmptyState(type) {
        elements.searchResultsList.innerHTML = "";
        let placeholderHtml = "";
        if (type === "no-videos") {
            placeholderHtml = `
                <div class="results-placeholder">
                    <i data-lucide="upload-cloud"></i>
                    <p>Upload your first video above to start searching.</p>
                </div>
            `;
        } else if (type === "processing") {
            placeholderHtml = `
                <div class="results-placeholder">
                    <i data-lucide="cpu" class="animate-spin"></i>
                    <p>Preparing your AI search index... search is temporarily disabled.</p>
                </div>
            `;
        } else if (type === "failed") {
            placeholderHtml = `
                <div class="results-placeholder">
                    <i data-lucide="alert-octagon" style="color: var(--error);"></i>
                    <p>AI compilation failed. Check file types or logs.</p>
                </div>
            `;
        } else if (type === "ready") {
            placeholderHtml = `
                <div class="results-placeholder">
                    <i data-lucide="sparkles"></i>
                    <p>What would you like to find?</p>
                </div>
            `;
        }
        elements.searchResultsList.innerHTML = placeholderHtml;
        if (window.lucide) {
            window.lucide.createIcons();
        }
    },

    async populateVideoFilterDropdown() {
        const previousVal = elements.searchVideoFilter.value;
        elements.searchVideoFilter.innerHTML = `<option value="">Across all videos</option>`;
        
        videosInventory.filter(v => v.status === "COMPLETED").forEach(v => {
            const opt = document.createElement("option");
            opt.value = v.id;
            opt.innerText = v.title;
            elements.searchVideoFilter.appendChild(opt);
        });
        elements.searchVideoFilter.value = previousVal;
    },

    openContextMenu(e, videoId) {
        e.preventDefault();
        elements.contextMenu.classList.add("active");
        elements.contextMenu.style.top = `${e.clientY}px`;
        elements.contextMenu.style.left = `${e.clientX}px`;
        
        document.getElementById("ctx-opt-open").onclick = () => app.selectVideoContext(videoId);
        document.getElementById("ctx-opt-rename").onclick = () => app.renameVideoContext(videoId);
        document.getElementById("ctx-opt-reprocess").onclick = () => app.reprocessVideoContext(videoId);
        document.getElementById("ctx-opt-copy-id").onclick = () => {
            navigator.clipboard.writeText(videoId);
            app.showToast("Copied Video ID to clipboard.", "info");
        };
        document.getElementById("ctx-opt-delete").onclick = () => app.deleteVideo(videoId);
    },

    async renameVideoContext(videoId) {
        const newName = prompt("Enter a new title for this video:");
        if (!newName) return;
        
        try {
            const response = await fetch(`${API_BASE}/api/v1/videos/${videoId}?title=${encodeURIComponent(newName)}`, {
                method: "PUT",
                headers: getHeaders()
            });
            if (response.ok) {
                app.showToast(`Video renamed to: "${newName}"`, "success");
                app.refreshDashboard();
            } else {
                app.showToast("Failed to rename video.", "error");
            }
        } catch (e) {
            console.error(e);
        }
    },

    async reprocessVideoContext(videoId) {
        if (!confirm("Are you sure you want to reprocess the AI search index for this video?")) return;
        
        try {
            const response = await fetch(`${API_BASE}/api/v1/videos/${videoId}/reprocess`, {
                method: "POST",
                headers: getHeaders()
            });
            if (response.ok) {
                app.showToast("Reprocessing task queued in background.", "info");
                app.selectVideoContext(videoId);
            } else {
                app.showToast("Failed to start reprocessing.", "error");
            }
        } catch (e) {
            console.error(e);
        }
    },

    async deleteVideo(videoId) {
        if (!confirm("Are you sure you want to completely purge this video, its frame assets, and embeddings?")) return;
        
        try {
            const response = await fetch(`${API_BASE}/api/v1/videos/${videoId}`, {
                method: "DELETE",
                headers: getHeaders()
            });
            if (response.ok) {
                app.showToast("Video and processed descriptors deleted.", "success");
                if (selectedVideoContextId === videoId) selectedVideoContextId = "";
                app.refreshDashboard();
            } else {
                app.showToast("Failed to delete video.", "error");
            }
        } catch (e) {
            console.error(e);
        }
    },

    toggleCommandPalette() {
        elements.commandPalette.classList.toggle("active");
        if (elements.commandPalette.classList.contains("active")) {
            elements.cmdPaletteInput.value = "";
            elements.cmdPaletteInput.focus();
            activeCommandPaletteIndex = 0;
            app.filterCommandPalette();
        }
    },

    closeCommandPalette() {
        elements.commandPalette.classList.remove("active");
    },

    filterCommandPalette() {
        const query = elements.cmdPaletteInput.value.toLowerCase().trim();
        elements.cmdPaletteResults.innerHTML = "";
        
        const commands = [
            { text: "Ingest Video (Open Upload Form)", action: () => { elements.fileInput.click(); app.closeCommandPalette(); }, icon: "upload" },
            { text: "Open Settings Configurations", action: () => { app.openSettings(); app.closeCommandPalette(); }, icon: "settings" },
            { text: "Clear system caches (Danger Purge All)", action: () => { app.purgeAllCatalog(); app.closeCommandPalette(); }, icon: "alert-triangle" }
        ];
        
        if (selectedVideoContextId !== "") {
            const activeVid = videosInventory.find(v => v.id === selectedVideoContextId);
            if (activeVid) {
                commands.push({
                    text: `Copy Video ID for: "${activeVid.title}"`,
                    action: () => { navigator.clipboard.writeText(selectedVideoContextId); app.showToast("Copied ID to clipboard.", "info"); app.closeCommandPalette(); },
                    icon: "copy"
                });
                commands.push({
                    text: `Reprocess AI Index for: "${activeVid.title}"`,
                    action: () => { app.reprocessVideoContext(selectedVideoContextId); app.closeCommandPalette(); },
                    icon: "refresh-cw"
                });
            }
        }

        const filteredCommands = commands.filter(c => c.text.toLowerCase().includes(query));
        const filteredVideos = videosInventory.filter(v => v.title.toLowerCase().includes(query) && v.status === "COMPLETED");
        
        if (filteredCommands.length > 0) {
            const cmdTitle = document.createElement("div");
            cmdTitle.className = "cmd-palette-group-title";
            cmdTitle.innerText = "System Commands";
            elements.cmdPaletteResults.appendChild(cmdTitle);
            
            filteredCommands.forEach((cmd, idx) => {
                const item = document.createElement("div");
                item.className = `cmd-item ${idx === 0 ? 'selected' : ''}`;
                item.innerHTML = `
                    <div class="cmd-item-left">
                        <i data-lucide="${cmd.icon}"></i>
                        <span>${cmd.text}</span>
                    </div>
                `;
                item.addEventListener("click", () => cmd.action());
                elements.cmdPaletteResults.appendChild(item);
            });
        }
        
        if (filteredVideos.length > 0) {
            const vidTitle = document.createElement("div");
            vidTitle.className = "cmd-palette-group-title";
            vidTitle.innerText = "Jump to Video Context";
            elements.cmdPaletteResults.appendChild(vidTitle);
            
            filteredVideos.forEach((vid) => {
                const item = document.createElement("div");
                item.className = "cmd-item";
                item.innerHTML = `
                    <div class="cmd-item-left">
                        <i data-lucide="video"></i>
                        <span>Select scope: "${vid.title}"</span>
                    </div>
                `;
                item.addEventListener("click", () => {
                    app.selectVideoContext(vid.id);
                    app.closeCommandPalette();
                });
                elements.cmdPaletteResults.appendChild(item);
            });
        }
        
        if (filteredCommands.length === 0 && filteredVideos.length === 0) {
            elements.cmdPaletteResults.innerHTML = `
                <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px;">
                    No commands or matching videos found.
                </div>
            `;
        }
        
        activeCommandPaletteIndex = 0;
        if (window.lucide) {
            window.lucide.createIcons();
        }
    },

    openSettings() {
        elements.settingsModal.classList.add("active");
        app.switchSettingsTab('tab-general');
    },

    closeSettings() {
        elements.settingsModal.classList.remove("active");
    },

    switchSettingsTab(tabId) {
        document.querySelectorAll(".settings-tab-link").forEach(lnk => lnk.classList.remove("active"));
        document.querySelectorAll(".settings-panel").forEach(pnl => pnl.classList.remove("active"));
        
        const tabLink = Array.from(document.querySelectorAll(".settings-tab-link")).find(lnk => lnk.getAttribute("onclick").includes(tabId));
        if (tabLink) tabLink.classList.add("active");
        
        const targetPanel = document.getElementById(tabId);
        if (targetPanel) targetPanel.classList.add("active");
    },

    async purgeAllCatalog() {
        if (!confirm("🚨 WARNING: This will completely delete ALL S3 frame assets, video clips, and database records! This action is permanent and cannot be undone. Proceed?")) return;
        
        app.showToast("Purging database catalog...", "warning");
        try {
            for (const v of videosInventory) {
                await fetch(`${API_BASE}/api/v1/videos/${v.id}`, {
                    method: "DELETE",
                    headers: getHeaders()
                });
            }
            app.showToast("Purge complete. Database catalog is now empty.", "success");
            selectedVideoContextId = "";
            app.refreshDashboard();
            app.closeSettings();
        } catch (e) {
            console.error("Purge failure:", e);
            app.showToast("Database purge encountered errors.", "error");
        }
    },

    toggleProfileDropdown() {
        elements.profileDropdown.classList.toggle("active");
    },

    changePlayerSpeed() {
        const rate = parseFloat(elements.playerPlaybackSpeed.value);
        elements.videoPlayer.playbackRate = rate;
        app.showToast(`Playback speed set to ${rate}x`, "info");
    },

    stepFrame(direction) {
        const frameTime = 1 / 30.0;
        elements.videoPlayer.currentTime = Math.max(0, Math.min(elements.videoPlayer.duration, elements.videoPlayer.currentTime + (direction * frameTime)));
    },

    seekSceneMatch(direction) {
        if (activeSearchMatches.length === 0) return;
        
        let nextIndex = (currentSearchMatchIndex + direction) % activeSearchMatches.length;
        if (nextIndex < 0) nextIndex = activeSearchMatches.length - 1;
        
        currentSearchMatchIndex = nextIndex;
        const hit = activeSearchMatches[currentSearchMatchIndex];
        
        elements.videoPlayer.currentTime = hit.timestamp;
        elements.videoPlayer.play();
        app.showToast(`Jumped to Match ${currentSearchMatchIndex + 1}/${activeSearchMatches.length}`, "success");
    },

    closeInlinePlayer() {
        elements.inlinePlayerWrapper.style.display = "none";
        elements.videoPlayer.pause();
        
        if (elements.detailsActive) elements.detailsActive.style.display = "none";
        if (elements.detailsEmpty) elements.detailsEmpty.style.display = "block";
    },

    refreshAnalytics() {
        elements.hardwareTarget.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span class="status-indicator-dot"></span>
                <span class="hardware-name" style="font-weight: 700;">NVIDIA RTX 3050 (CUDA)</span>
            </div>
        `;
    },

    showToast(message, type = "success") {
        const container = document.getElementById("toast-container");
        if (!container) return;
        
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        
        let icon = "check-circle";
        if (type === "error") icon = "alert-octagon";
        if (type === "warning") icon = "alert-triangle";
        if (type === "info") icon = "info";
        
        toast.innerHTML = `
            <i data-lucide="${icon}"></i>
            <span class="toast-message">${message}</span>
        `;
        container.appendChild(toast);
        
        if (window.lucide) {
            window.lucide.createIcons();
        }
        
        setTimeout(() => {
            toast.classList.add("removing");
            toast.addEventListener("animationend", () => {
                toast.remove();
            });
        }, 4500);
    }
};

// --- Ingestion Upload Engine ---
function setupUploadHandlers() {
    elements.dropZone.addEventListener("click", () => elements.fileInput.click());
    
    elements.dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        elements.dropZone.classList.add("active");
    });
    
    elements.dropZone.addEventListener("dragleave", () => {
        elements.dropZone.classList.remove("active");
    });
    
    elements.dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        elements.dropZone.classList.remove("active");
        if (e.dataTransfer.files.length > 0) {
            elements.fileInput.files = e.dataTransfer.files;
            handleFileSelect();
        }
    });

    elements.fileInput.addEventListener("change", handleFileSelect);
    elements.uploadSubmitBtn.addEventListener("click", uploadVideoFile);
}

function handleFileSelect() {
    const file = elements.fileInput.files[0];
    if (file) {
        app.showToast(`Selected file: ${file.name}`, "info");
        if (!elements.uploadTitleInput.value) {
            elements.uploadTitleInput.value = file.name.replace(/\.[^/.]+$/, "");
        }
    }
}

function uploadVideoFile() {
    const file = elements.fileInput.files[0];
    if (!file) {
        app.showToast("Select a video file to upload first.", "warning");
        return;
    }
    
    const title = elements.uploadTitleInput.value || file.name.replace(/\.[^/.]+$/, "");
    
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);
    
    const uploadUrl = `${API_BASE}/api/v1/videos/upload?title=${encodeURIComponent(title)}`;
    xhr.open("POST", uploadUrl, true);
    xhr.setRequestHeader("Authorization", `Bearer ${AUTH_TOKEN}`);
    
    elements.uploadProgressBox.style.display = "flex";
    elements.uploadSubmitBtn.disabled = true;
    elements.uploadStatusText.innerText = "Uploading binary chunks to storage...";
    
    xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            elements.uploadProgressFill.style.width = `${percent}%`;
            elements.uploadPercentageLabel.innerText = `${percent}%`;
        }
    });
    
    xhr.onload = () => {
        elements.uploadSubmitBtn.disabled = false;
        if (xhr.status === 201) {
            app.showToast("Upload complete. Ingest starting...", "success");
            elements.uploadProgressFill.style.width = "100%";
            elements.uploadPercentageLabel.innerText = "100%";
            
            let uploadedVideoId = null;
            try {
                const responseData = JSON.parse(xhr.responseText);
                uploadedVideoId = responseData.id;
            } catch (err) {
                console.error("Error parsing upload response:", err);
            }
            
            setTimeout(() => {
                elements.fileInput.value = "";
                elements.uploadTitleInput.value = "";
                elements.uploadProgressBox.style.display = "none";
                
                app.refreshDashboard().then(() => {
                    if (uploadedVideoId) {
                        app.selectVideoContext(uploadedVideoId);
                    }
                });
            }, 1000);
        } else {
            app.showToast("Upload failed.", "error");
        }
    };
    
    xhr.onerror = () => {
        elements.uploadSubmitBtn.disabled = false;
        app.showToast("Network transmission error.", "error");
    };
    
    xhr.send(formData);
}

// --- Prompt suggestions and history ---
function setupPromptSuggestions() {
    // Correctly bind directly to prompt-chip elements
    document.querySelectorAll(".prompt-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            elements.searchQueryInput.value = chip.innerText;
            triggerSearchQuery();
        });
    });
}

function loadRecentQueries() {
    try {
        const stored = localStorage.getItem("aura_recent_searches");
        if (stored) {
            recentQueries = JSON.parse(stored);
            renderRecentQueries();
        }
    } catch (e) {
        console.error("Local storage read error:", e);
    }
}

function saveRecentQuery(query) {
    recentQueries = recentQueries.filter(q => q !== query);
    recentQueries.unshift(query);
    recentQueries = recentQueries.slice(0, 5);
    
    try {
        localStorage.setItem("aura_recent_searches", JSON.stringify(recentQueries));
        renderRecentQueries();
    } catch (e) {
        console.error("Local storage save error:", e);
    }
}

function renderRecentQueries() {
    elements.recentQueriesList.innerHTML = "";
    if (recentQueries.length === 0) {
        elements.recentQueriesList.innerHTML = `<div class="recent-empty">No recent searches</div>`;
        return;
    }
    
    recentQueries.forEach(q => {
        const el = document.createElement("div");
        el.className = "recent-search-item";
        el.innerText = q;
        el.addEventListener("click", () => {
            elements.searchQueryInput.value = q;
            triggerSearchQuery();
        });
        elements.recentQueriesList.appendChild(el);
    });
}

// --- Multimodal Search Studio Logic ---
function setupSearchHandlers() {
    elements.searchBtn.addEventListener("click", triggerSearchQuery);
    elements.searchQueryInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") triggerSearchQuery();
    });
    
    elements.searchVideoFilter.addEventListener("change", () => {
        const filterVal = elements.searchVideoFilter.value;
        if (filterVal !== selectedVideoContextId) {
            app.selectVideoContext(filterVal);
        }
    });
}

async function triggerSearchQuery() {
    const query = elements.searchQueryInput.value.trim();
    if (!query) return;
    
    saveRecentQuery(query);
    
    elements.searchResultsList.innerHTML = `
        <div class="results-placeholder">
            <i data-lucide="loader-2" class="animate-spin" style="width: 32px; height: 32px; color: var(--accent-mid);"></i>
            <p>Scanning Qdrant vectors and parsing Whisper transcripts...</p>
        </div>
    `;
    if (window.lucide) {
        window.lucide.createIcons();
    }
    
    elements.resultsCountText.innerText = "Querying database...";
    elements.resultsLatencyText.innerText = "Query latency: 0.0ms";

    try {
        let url = `${API_BASE}/api/v1/search?q=${encodeURIComponent(query)}&top_k=15`;
        if (selectedVideoContextId) {
            url += `&video_id=${selectedVideoContextId}`;
        }
        
        const response = await fetch(url, { headers: getHeaders() });
        if (!response.ok) throw new Error("Search execution failed");
        
        const data = await response.json();
        const sortedResults = data.results.slice(0, 3);
        
        activeSearchMatches = sortedResults;
        currentSearchMatchIndex = 0;
        
        elements.resultsLatencyText.innerText = `Query latency: ${data.latency_ms}ms`;
        elements.resultsCountText.innerText = `${sortedResults.length} matching scenes found (showing top 3)`;
        
        elements.searchResultsList.innerHTML = "";
        
        if (sortedResults.length === 0) {
            elements.searchResultsList.innerHTML = `
                <div class="results-placeholder">
                    <i data-lucide="frown" style="width: 38px; height: 38px;"></i>
                    <p>No matching scenes found for "${query}". Try broadening your search tags.</p>
                </div>
            `;
            if (window.lucide) {
                window.lucide.createIcons();
            }
            return;
        }

        sortedResults.forEach((hit, idx) => {
            const card = document.createElement("div");
            card.className = "search-hit-card-premium";
            
            const startMin = Math.floor(hit.start_time / 60).toString().padStart(2, '0');
            const startSec = Math.floor(hit.start_time % 60).toString().padStart(2, '0');
            const matchTime = `${startMin}:${startSec}`;
            
            const scorePercent = Math.round(hit.similarity_score * 100);
            
            const videoObj = videosInventory.find(v => v.id === hit.video_id);
            let videoFilename = "";
            if (videoObj) {
                videoFilename = videoObj.storage_path.replace(/\\/g, "/").split("/").pop();
            }
            
            const startTime = Math.max(0, hit.timestamp - 1.5);
            const endTime = startTime + 3.0;
            const videoStreamUrl = `${API_BASE}/api/v1/videos/stream/videos/${videoFilename}#t=${startTime},${endTime}`;
            const thumbUrl = hit.frame_image_url;
            
            let tagsHtml = "";
            if (hit.objects && hit.objects.length > 0) {
                hit.objects.slice(0, 3).forEach(obj => {
                    tagsHtml += `<span class="meta-tag">${obj}</span>`;
                });
            } else {
                tagsHtml = `<span class="tag-empty" style="font-size: 10px;">No tags</span>`;
            }
            
            card.innerHTML = `
                <!-- LEFT: Autoplay Looping video preview -->
                <div class="card-sec-player">
                    <div class="video-shimmer" id="shimmer-${hit.id}-${idx}"></div>
                    <video id="loop-video-${hit.id}-${idx}" autoplay loop muted playsinline preload="auto" src="${videoStreamUrl}"></video>
                    <span class="play-timestamp-overlay">${matchTime}</span>
                </div>
                
                <!-- CENTER: Exact Matched Frame -->
                <div class="card-sec-frame" id="frame-click-${hit.id}-${idx}" title="Click to seek loop preview to match point">
                    <img src="${thumbUrl}" alt="Matched Frame" onerror="this.src='https://images.unsplash.com/photo-1594909122845-11baa439b7bf?q=80&w=200&auto=format&fit=crop'">
                    <span class="frame-badge-overlay">Matched Frame</span>
                </div>
                
                <!-- RIGHT: Metadata Panel -->
                <div class="card-sec-meta">
                    <div class="meta-header">
                        <h4 class="meta-title" title="${hit.video_title}">${hit.video_title}</h4>
                        <div class="meta-score-row">
                            <span class="score-badge"><i data-lucide="percent" style="width: 10px; height: 10px; stroke-width: 3;"></i> ${scorePercent}% Match</span>
                        </div>
                        <p class="meta-caption">${hit.caption || 'No visual description available.'}</p>
                        ${hit.transcript_snippet ? `<p class="meta-speech-match">"${hit.transcript_snippet}"</p>` : ''}
                        <div class="meta-tags-container">
                            ${tagsHtml}
                        </div>
                    </div>
                    <button class="btn btn-primary btn-sm btn-open-drawer" id="btn-player-expand-${hit.id}-${idx}">
                        <span>View Moment</span>
                        <i data-lucide="play-circle" style="width: 16px; height: 16px;"></i>
                    </button>
                </div>
            `;
            
            elements.searchResultsList.appendChild(card);
            
            const videoEl = document.getElementById(`loop-video-${hit.id}-${idx}`);
            const shimmerEl = document.getElementById(`shimmer-${hit.id}-${idx}`);
            
            if (videoEl && shimmerEl) {
                videoEl.addEventListener("playing", () => {
                    shimmerEl.style.opacity = "0";
                    setTimeout(() => { shimmerEl.style.display = "none"; }, 500);
                });
            }
            
            if (videoEl) {
                videoEl.currentTime = startTime;
                videoEl.addEventListener("timeupdate", () => {
                    if (videoEl.currentTime >= endTime || videoEl.currentTime < startTime - 0.5) {
                        videoEl.currentTime = startTime;
                    }
                });
            }
            
            const frameClickEl = document.getElementById(`frame-click-${hit.id}-${idx}`);
            if (frameClickEl && videoEl) {
                frameClickEl.addEventListener("click", () => {
                    videoEl.currentTime = hit.timestamp;
                    videoEl.play();
                });
            }
            
            const btnPlayerExpand = document.getElementById(`btn-player-expand-${hit.id}-${idx}`);
            if (btnPlayerExpand) {
                btnPlayerExpand.addEventListener("click", () => {
                    currentSearchMatchIndex = idx;
                    app.expandInlinePlayer(hit);
                });
            }
        });
        
        if (window.lucide) {
            window.lucide.createIcons();
        }
        
    } catch (err) {
        console.error("Search execution error:", err);
        app.showToast("Failed to search database.", "error");
    }
}

app.expandInlinePlayer = function(hit) {
    const videoObj = videosInventory.find(v => v.id === hit.video_id);
    if (!videoObj) return;
    
    const videoFilename = videoObj.storage_path.replace(/\\/g, "/").split("/").pop();
    const videoStreamUrl = `${API_BASE}/api/v1/videos/stream/videos/${videoFilename}`;
    
    elements.inlinePlayerWrapper.style.display = "block";
    
    const previousSrc = elements.videoPlayer.getAttribute("src");
    if (previousSrc !== videoStreamUrl) {
        elements.videoPlayer.src = videoStreamUrl;
        elements.videoPlayer.load();
    }
    
    elements.playerVideoTitle.innerText = hit.video_title;
    
    loopSceneStart = hit.start_time;
    loopSceneEnd = hit.end_time;
    
    elements.videoPlayer.ontimeupdate = () => {
        const shouldLoop = elements.playerLoopSceneCheck.checked;
        if (shouldLoop && (elements.videoPlayer.currentTime >= loopSceneEnd || elements.videoPlayer.currentTime < loopSceneStart - 0.5)) {
            elements.videoPlayer.currentTime = loopSceneStart;
        }
    };
    
    elements.videoPlayer.oncanplay = () => {
        elements.videoPlayer.currentTime = hit.timestamp;
        elements.videoPlayer.play();
        elements.videoPlayer.oncanplay = null;
    };
    
    if (elements.videoPlayer.readyState >= 2) {
        elements.videoPlayer.currentTime = hit.timestamp;
        elements.videoPlayer.play();
    }
    
    elements.inlinePlayerWrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    
    if (elements.detailsEmpty) elements.detailsEmpty.style.display = "none";
    if (elements.detailsActive) elements.detailsActive.style.display = "block";
    
    if (elements.detailsFrameImg) elements.detailsFrameImg.src = hit.frame_image_url;
    if (elements.playerScoreBadge) elements.playerScoreBadge.innerText = `${Math.round(hit.similarity_score * 100)}% Match`;
    
    const startMin = Math.floor(hit.start_time / 60).toString().padStart(2, '0');
    const startSec = Math.floor(hit.start_time % 60).toString().padStart(2, '0');
    const endMin = Math.floor(hit.end_time / 60).toString().padStart(2, '0');
    const endSec = Math.floor(hit.end_time % 60).toString().padStart(2, '0');
    if (elements.playerTimestampBadge) elements.playerTimestampBadge.innerText = `${startMin}:${startSec} - ${endMin}:${endSec}`;
    
    if (elements.playerCaptionText) elements.playerCaptionText.innerText = hit.caption || "No visual caption generated";
    if (elements.playerSpeechText) elements.playerSpeechText.innerText = hit.transcript_snippet ? `"${hit.transcript_snippet}"` : "No spoken transcript matching this scene.";
    
    const scorePercent = Math.round(hit.similarity_score * 100);
    if (elements.playerAiExplanation) elements.playerAiExplanation.innerText = `AURA matches this scene with a confidence score of ${scorePercent}% based on SigLIP visual semantic features. The timeline coordinates overlapping at ${startMin}:${startSec} contain visual entities (${hit.objects.join(", ")}) corresponding to your prompt, matching both frame features and transcribed vocal layers.`;
    
    if (elements.playerObjectsContainer) {
        elements.playerObjectsContainer.innerHTML = "";
        if (hit.objects && hit.objects.length > 0) {
            hit.objects.forEach(obj => {
                const span = document.createElement("span");
                span.className = "tag";
                span.innerText = obj;
                elements.playerObjectsContainer.appendChild(span);
            });
        } else {
            elements.playerObjectsContainer.innerHTML = `<span class="tag-empty">No objects categorized</span>`;
        }
    }
    
    app.showToast("Clip loaded into workspace player.", "success");
    
    if (window.lucide) {
        window.lucide.createIcons();
    }
};
