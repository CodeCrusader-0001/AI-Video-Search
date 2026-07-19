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
    initPlaceholderTypingAnimation();
    
    // Auto-authenticate default guest profile to acquire JWT tokens
    const connected = await authenticateDeveloper();
    if (connected) {
        updateConnectionStatus(true);
        app.refreshDashboard();
    } else {
        updateConnectionStatus(false, "Server Offline");
    }
});

function initPlaceholderTypingAnimation() {
    const input = document.getElementById("search-query-input");
    if (!input) return;
    
    const placeholders = [
        "Find a red sports car",
        "Someone entering a room",
        "Dog running on road",
        "Show scenes with laptop",
        "Search anything inside your videos..."
    ];
    
    let currentIdx = 0;
    let charIdx = 0;
    let isDeleting = false;
    let typingSpeed = 100;
    
    function type() {
        const fullText = placeholders[currentIdx];
        if (isDeleting) {
            input.setAttribute("placeholder", fullText.substring(0, charIdx - 1));
            charIdx--;
            typingSpeed = 50;
        } else {
            input.setAttribute("placeholder", fullText.substring(0, charIdx + 1));
            charIdx++;
            typingSpeed = 100;
        }
        
        if (!isDeleting && charIdx === fullText.length) {
            isDeleting = true;
            typingSpeed = 2000;
        } else if (isDeleting && charIdx === 0) {
            isDeleting = false;
            currentIdx = (currentIdx + 1) % placeholders.length;
            typingSpeed = 500;
        }
        
        setTimeout(type, typingSpeed);
    }
    
    setTimeout(type, 1000);
}

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
                    
                    let statusHtml = "";
                    let progressRingHtml = "";
                    
                    if (v.status === "PROCESSING" || v.status === "PENDING") {
                        const progressVal = v.progress || 0;
                        progressRingHtml = `
                            <div class="card-progress-ring-wrapper">
                                <svg class="progress-ring" width="28" height="28">
                                    <circle class="progress-ring-circle-bg" stroke="rgba(255,255,255,0.06)" stroke-width="2.5" fill="transparent" r="11" cx="14" cy="14"/>
                                    <circle class="progress-ring-circle-fill" stroke="var(--accent-mid)" stroke-width="2.5" stroke-dasharray="69" stroke-dashoffset="${69 - (69 * progressVal / 100)}" stroke-linecap="round" fill="transparent" r="11" cx="14" cy="14"/>
                                </svg>
                                <span class="progress-ring-text">${progressVal}%</span>
                            </div>
                        `;
                        statusHtml = `<span class="library-status-badge processing"><span class="pulse-dot"></span> PROCESSING</span>`;
                    } else if (v.status === "COMPLETED") {
                        progressRingHtml = `
                            <div class="card-status-icon completed" title="Indexing Complete">
                                <i data-lucide="check-circle-2" class="completed-icon"></i>
                            </div>
                        `;
                        statusHtml = `
                            <div class="card-status-row">
                                <span class="library-status-badge completed">🟢 READY</span>
                            </div>
                        `;
                    } else {
                        progressRingHtml = `
                            <div class="card-status-icon failed" title="Indexing Failed">
                                <i data-lucide="alert-circle" class="failed-icon"></i>
                            </div>
                        `;
                        statusHtml = `<span class="library-status-badge failed">🔴 FAILED</span>`;
                    }
                    
                    card.innerHTML = `
                        <!-- Left aspect thumbnail block -->
                        <div class="library-card-thumbnail">
                            <i data-lucide="film"></i>
                        </div>
                        
                        <!-- Center details -->
                        <div class="library-card-details">
                            <span class="card-video-title" title="${v.title}">${v.title}</span>
                            <span class="card-date">${createdDate} &bull; ${durationText}</span>
                            ${statusHtml}
                        </div>
                        
                        <!-- Right Status / Progress Indicator -->
                        <div class="library-card-status-aside">
                            ${progressRingHtml}
                        </div>
                        
                        <!-- Absolute Action Overlay buttons -->
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
        elements.searchVideoFilter.innerHTML = `<option value="">All Videos</option>`;
        
        videosInventory.filter(v => v.status === "COMPLETED").forEach(v => {
            const opt = document.createElement("option");
            opt.value = v.id;
            opt.innerText = `🎥 ${v.title}`;
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
        const activeVideo = videosInventory.find(v => v.status === "PROCESSING" || v.status === "PENDING");
        const hasActiveJobs = !!activeVideo;
        
        const pulseDot = document.getElementById("monitor-pulse-dot");
        const workerStatus = document.getElementById("monitor-worker-status");
        const vramText = document.getElementById("monitor-vram-text");
        const vramFill = document.getElementById("monitor-vram-fill");
        const queueCount = document.getElementById("monitor-queue-count");
        
        if (pulseDot && workerStatus && vramText && vramFill && queueCount) {
            if (hasActiveJobs) {
                pulseDot.className = "pulse-dot active";
                workerStatus.innerText = `Worker: INGESTING`;
                
                const progressFactor = activeVideo.progress || 0;
                const vramUsed = (2.2 + (progressFactor / 100) * 1.8).toFixed(1);
                vramText.innerText = `${vramUsed}GB / 6.0GB`;
                vramFill.style.width = `${(vramUsed / 6.0) * 100}%`;
                
                queueCount.innerText = "1 job";
                queueCount.className = "queue-badge busy";
            } else {
                pulseDot.className = "pulse-dot";
                workerStatus.innerText = "Worker: IDLE";
                
                vramText.innerText = "1.2GB / 6.0GB";
                vramFill.style.width = "20%";
                
                queueCount.innerText = "0 jobs";
                queueCount.className = "queue-badge";
            }
        }
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
        const dropdown = document.getElementById("search-autocomplete-dropdown");
        const isOpen = dropdown && dropdown.classList.contains("active");
        
        if (isOpen) {
            const items = dropdown.querySelectorAll(".auto-item");
            if (items.length > 0) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    
                    let activeIdx = -1;
                    items.forEach((item, idx) => {
                        if (item.classList.contains("selected")) activeIdx = idx;
                    });
                    
                    if (activeIdx !== -1) {
                        items[activeIdx].classList.remove("selected");
                    }
                    
                    if (e.key === "ArrowDown") {
                        activeIdx = (activeIdx + 1) % items.length;
                    } else {
                        activeIdx = (activeIdx - 1 + items.length) % items.length;
                    }
                    
                    items[activeIdx].classList.add("selected");
                    items[activeIdx].scrollIntoView({ block: 'nearest' });
                    return;
                }
                
                if (e.key === "Enter") {
                    let activeIdx = -1;
                    items.forEach((item, idx) => {
                        if (item.classList.contains("selected")) activeIdx = idx;
                    });
                    
                    if (activeIdx !== -1) {
                        e.preventDefault();
                        items[activeIdx].click();
                        return;
                    }
                }
            }
        }
        
        if (e.key === "Enter") {
            triggerSearchQuery();
        }
    });
    
    elements.searchQueryInput.addEventListener("input", () => {
        app.showAutocompleteDropdown();
    });
    
    elements.searchQueryInput.addEventListener("blur", () => {
        setTimeout(() => {
            app.hideAutocompleteDropdown();
        }, 200);
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
    
    app.hideAutocompleteDropdown();
    saveRecentQuery(query);
    
    // Set button loading state
    elements.searchBtn.disabled = true;
    const originalBtnHtml = `<i data-lucide="sparkles"></i><span>Search</span>`;
    elements.searchBtn.innerHTML = `<i data-lucide="loader-2" class="animate-spin"></i><span>Searching...</span>`;
    if (window.lucide) window.lucide.createIcons();
    
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
            let recentChipsHtml = "";
            if (recentQueries.length > 0) {
                recentQueries.slice(0, 4).forEach(q => {
                    recentChipsHtml += `<span class="empty-chip" onclick="app.selectAutoItem('${q.replace(/'/g, "\\'")}')">${q}</span>`;
                });
            } else {
                recentChipsHtml = `<span style="font-size: 11px; color: var(--text-muted);">No recent queries</span>`;
            }
            
            elements.searchResultsList.innerHTML = `
                <div class="results-empty-state">
                    <div class="empty-state-icon">
                        <i data-lucide="frown"></i>
                    </div>
                    <h3>No matching scenes found</h3>
                    <p>We couldn't find any moments matching "<strong>${query}</strong>" in the video collection. Try modifying your search terms.</p>
                    
                    <div class="empty-suggestions-section">
                        <h4>Suggested Searches</h4>
                        <div class="empty-chips-group">
                            <span class="empty-chip" onclick="app.selectAutoItem('A person entering a room')">A person entering a room</span>
                            <span class="empty-chip" onclick="app.selectAutoItem('Red sports car')">Red sports car</span>
                            <span class="empty-chip" onclick="app.selectAutoItem('Someone opening a laptop')">Someone opening a laptop</span>
                        </div>
                    </div>
                    
                    <div class="empty-suggestions-section" style="margin-top: 20px;">
                        <h4>Recently Searched</h4>
                        <div class="empty-chips-group">
                            ${recentChipsHtml}
                        </div>
                    </div>
                </div>
            `;
            if (window.lucide) {
                window.lucide.createIcons();
            }
            
            elements.searchBtn.disabled = false;
            elements.searchBtn.innerHTML = originalBtnHtml;
            if (window.lucide) window.lucide.createIcons();
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
            
            const durationVal = videoObj ? videoObj.duration_seconds : 180;
            const startPct = ((hit.start_time / durationVal) * 100).toFixed(1);
            const durationPct = (((hit.end_time - hit.start_time) / durationVal) * 100).toFixed(1);
            const durationFormatted = `${Math.floor(hit.end_time - hit.start_time)}s`;
            
            let tagsHtml = "";
            if (hit.objects && hit.objects.length > 0) {
                hit.objects.slice(0, 4).forEach(obj => {
                    tagsHtml += `<span class="result-object-tag">${obj}</span>`;
                });
            } else {
                tagsHtml = `<span class="result-object-tag-empty">No objects</span>`;
            }
            
            const mockOcrText = hit.objects.length > 0 
                ? `TEXT DETECTED: [OCR] "${hit.objects.slice(0,2).join(" | ").toUpperCase()}" detected on screen`
                : `TEXT DETECTED: [OCR] No overlay text detected in this scene`;
            
            card.innerHTML = `
                <!-- Column 1: Video Preview Panel (hover to autoplay) -->
                <div class="result-card-media-panel">
                    <div class="media-container">
                        <div class="video-shimmer" id="shimmer-${hit.id}-${idx}"></div>
                        <video id="loop-video-${hit.id}-${idx}" loop muted playsinline preload="auto" src="${videoStreamUrl}"></video>
                        <span class="result-timestamp-badge">${matchTime}</span>
                        <div class="result-play-overlay">
                            <i data-lucide="play"></i>
                        </div>
                    </div>
                    
                    <div class="result-timeline-minimap" title="Timeline location of scene: ${startMin}:${startSec}">
                        <div class="timeline-bar-bg">
                            <div class="timeline-bar-segment" style="left: ${startPct}%; width: ${durationPct}%;"></div>
                        </div>
                        <span class="timeline-minimap-label">Match: ${durationFormatted} at ${startPct}%</span>
                    </div>
                </div>
                
                <!-- Column 2: Keyframe Thumbnail Panel -->
                <div class="result-card-frame-panel" id="frame-click-${hit.id}-${idx}" title="Click to inspect frame details">
                    <div class="frame-container">
                        <img src="${thumbUrl}" alt="Matched Keyframe" onerror="this.src='https://images.unsplash.com/photo-1594909122845-11baa439b7bf?q=80&w=200&auto=format&fit=crop'">
                        <span class="frame-label-overlay">Matched Frame</span>
                        <span class="frame-zoom-overlay"><i data-lucide="zoom-in"></i> Click to Zoom</span>
                    </div>
                    <div class="result-match-score-badge">
                        <i data-lucide="sparkles"></i>
                        <span>${scorePercent}% Match</span>
                    </div>
                </div>
                
                <!-- Column 3: Right details metadata panels -->
                <div class="result-card-meta-panel">
                    <div class="result-meta-header">
                        <span class="result-video-source-title" title="${hit.video_title}">${hit.video_title}</span>
                        <h4 class="result-scene-index-title">Scene Segment #${idx + 1}</h4>
                    </div>
                    
                    <div class="result-caption-content">
                        <p class="result-blip-caption" title="AI Visual Description"><i data-lucide="eye"></i> ${hit.caption || 'No visual description available.'}</p>
                        ${hit.transcript_snippet ? `<p class="result-whisper-speech" title="Speech Transcript"><i data-lucide="message-square"></i> "${hit.transcript_snippet}"</p>` : ''}
                        <p class="result-ocr-text" title="OCR Scanner"><i data-lucide="scan-text"></i> ${mockOcrText}</p>
                    </div>
                    
                    <div class="result-objects-chips">
                        ${tagsHtml}
                    </div>
                    
                    <div class="result-actions-row">
                        <button class="btn btn-primary btn-sm btn-open-moment" id="btn-player-expand-${hit.id}-${idx}">
                            <i data-lucide="play"></i>
                            <span>View Moment</span>
                        </button>
                        <button class="btn btn-secondary btn-sm btn-jump-timestamp" id="btn-jump-time-${hit.id}-${idx}">
                            <i data-lucide="clock"></i>
                            <span>Jump to ${matchTime}</span>
                        </button>
                    </div>
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
            
            // Hover play interactions
            const mediaContainerEl = card.querySelector(".media-container");
            if (mediaContainerEl && videoEl) {
                mediaContainerEl.addEventListener("mouseenter", () => {
                    videoEl.play().catch(err => console.log("Hover play error: ", err));
                });
                mediaContainerEl.addEventListener("mouseleave", () => {
                    videoEl.pause();
                    videoEl.currentTime = startTime;
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

            const btnJumpTimestamp = document.getElementById(`btn-jump-time-${hit.id}-${idx}`);
            if (btnJumpTimestamp) {
                btnJumpTimestamp.addEventListener("click", () => {
                    currentSearchMatchIndex = idx;
                    app.expandInlinePlayer(hit);
                });
            }
        });
        
        if (window.lucide) {
            window.lucide.createIcons();
        }
        
        // Restore button state
        elements.searchBtn.disabled = false;
        elements.searchBtn.innerHTML = originalBtnHtml;
        if (window.lucide) window.lucide.createIcons();
        
    } catch (err) {
        console.error("Search execution error:", err);
        app.showToast("Failed to search database.", "error");
        
        // Restore button state on error
        elements.searchBtn.disabled = false;
        elements.searchBtn.innerHTML = `<i data-lucide="sparkles"></i><span>Search</span>`;
        if (window.lucide) window.lucide.createIcons();
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
    
    const transcriptBody = document.getElementById("player-transcript-body");
    if (transcriptBody) {
        if (hit.transcript_snippet) {
            const matchMin = Math.floor(hit.timestamp / 60).toString().padStart(2, '0');
            const matchSec = Math.floor(hit.timestamp % 60).toString().padStart(2, '0');
            transcriptBody.innerHTML = `
                <div class="transcript-segment-row active">
                    <div class="segment-bullet"><i data-lucide="volume-2"></i></div>
                    <div class="segment-content">
                        <span class="segment-time">${matchMin}:${matchSec}</span>
                        <p class="segment-text">"${hit.transcript_snippet}"</p>
                    </div>
                </div>
                <div class="transcript-segment-row info">
                    <div class="segment-bullet"><i data-lucide="info"></i></div>
                    <div class="segment-content">
                        <span class="segment-time-label">AI Processing Meta</span>
                        <p class="segment-text-meta">Whisper ASR extracted this segment at similarity threshold cutoff point.</p>
                    </div>
                </div>
            `;
        } else {
            transcriptBody.innerHTML = `
                <div class="transcript-empty-state">
                    <i data-lucide="mic-off" class="empty-transcript-icon"></i>
                    <p>No audio tracks/dialogue detected in this segment.</p>
                </div>
            `;
        }
    }
    
    app.showToast("Clip loaded into workspace player.", "success");
    
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

app.showAutocompleteDropdown = function() {
    const el = document.getElementById("search-autocomplete-dropdown");
    if (el && document.activeElement === elements.searchQueryInput) {
        el.classList.add("active");
    }
};

app.hideAutocompleteDropdown = function() {
    const el = document.getElementById("search-autocomplete-dropdown");
    if (el) {
        el.classList.remove("active");
    }
};

app.selectAutoItem = function(val) {
    elements.searchQueryInput.value = val;
    app.hideAutocompleteDropdown();
    triggerSearchQuery();
};

app.startVoiceSearch = function(btn) {
    if (btn.classList.contains("recording")) return;
    btn.classList.add("recording");
    app.showToast("Voice capture active - speak now...", "info");
    setTimeout(() => {
        btn.classList.remove("recording");
        app.showToast("Voice capture completed.", "success");
    }, 4000);
};

app.setFilterType = function(type) {
    document.querySelectorAll(".filter-chips-group:not(.dates) .filter-chip").forEach(el => {
        el.classList.remove("active");
        if (el.innerText.toLowerCase() === type.toLowerCase()) el.classList.add("active");
    });
    app.showToast(`Search filter scoped to: ${type.toUpperCase()}`, "info");
};

app.setDateFilter = function(date) {
    document.querySelectorAll(".filter-chips-group.dates .filter-chip").forEach(el => {
        el.classList.remove("active");
        if (el.innerText.toLowerCase().includes(date.toLowerCase()) || (date === 'all' && el.innerText.toLowerCase() === 'anytime')) {
            el.classList.add("active");
        }
    });
    app.showToast(`Time filter scoped to: ${date.toUpperCase()}`, "info");
};

app.updateThresholdLabel = function(val) {
    const label = document.getElementById("threshold-val-label");
    if (label) label.innerText = `${val}%`;
};

// Close autocomplete dropdown when clicking outside
document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-input-wrapper")) {
        app.hideAutocompleteDropdown();
    }
});
