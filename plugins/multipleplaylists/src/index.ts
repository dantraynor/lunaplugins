import { LunaUnload, Tracer } from "@luna/core";
import { MediaItem, redux, ContextMenu, Playlist } from "@luna/lib";

export const { trace, errSignal } = Tracer("[MultiplePlaylists]");
// You typically will never manually set errSignal. Its handled when trace.err or similar is called

trace.msg.log(`MultiplePlaylists plugin loaded for ${redux.store.getState().user?.meta?.profileName || 'user'}`);

// plugin settings
export { Settings } from "./Settings.js";

// Functions in unloads are called when plugin is unloaded.
// Used to clean up resources, event listener dispose etc should be added here
export const unloads = new Set<LunaUnload>();

// Function to show playlist selector modal
async function showPlaylistSelector(song: MediaItem) {

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    // Create modal content
    const modal = document.createElement('div');
    modal.style.cssText = `
        background: var(--background-color, #1a1a1a);
        border-radius: 8px;
        padding: 24px;
        max-width: 500px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
        color: var(--text-color, white);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    `;

    // Get song details
    const songTitle = song.title ? await song.title() : 'Unknown Song';
    let songArtist = 'Unknown Artist';
    
    // Try to get artist information
    try {
        if (song.artist) {
            const artist = await song.artist();
            if (artist && artist.name) {
                songArtist = artist.name;
            }
        } else if (song.artists) {
            const artists = await song.artists();
            if (artists && artists.length > 0) {
                // Get the first artist
                const firstArtist = await artists[0];
                if (firstArtist && firstArtist.name) {
                    songArtist = firstArtist.name;
                }
            }
        }
    } catch (error) {
        trace.err("Error getting artist information:", error);
        songArtist = 'Unknown Artist';
    }

    modal.innerHTML = `
        <h2 style="margin: 0 0 16px 0; font-size: 18px;">Add to Multiple Playlists</h2>
        <div style="margin-bottom: 16px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 4px;">
            <div style="font-weight: 500;">${songTitle}</div>
            <div style="font-size: 14px; opacity: 0.7;">${songArtist}</div>
        </div>
        <p style="margin: 0 0 16px 0; opacity: 0.7;">Select playlists to add this song to:</p>
        <div id="playlist-list" style="margin-bottom: 20px;"></div>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button id="cancel-btn" style="
                padding: 8px 16px;
                background: transparent;
                border: 1px solid var(--border-color, #444);
                border-radius: 4px;
                color: var(--text-color, white);
                cursor: pointer;
            ">Cancel</button>
            <button id="add-btn" style="
                padding: 8px 16px;
                background: var(--primary-color, #007acc);
                border: none;
                border-radius: 4px;
                color: white;
                cursor: pointer;
            ">Add to Selected Playlists</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Populate playlist list
    populatePlaylistList();

    // Event listeners
    const cancelBtn = modal.querySelector('#cancel-btn');
    const addBtn = modal.querySelector('#add-btn');

    cancelBtn?.addEventListener('click', () => {
        document.body.removeChild(overlay);
    });

    addBtn?.addEventListener('click', () => {
        addToSelectedPlaylists(song);
        document.body.removeChild(overlay);
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            document.body.removeChild(overlay);
        }
    });
}

// Function to populate the playlist list using a safer approach
async function populatePlaylistList() {
    const playlistContainer = document.querySelector('#playlist-list');
    if (!playlistContainer) return;

    try {
        // Try to use Playlist API methods if available (safer approach)
        let playlistsArray: any[] = [];
        
        try {
            // Check if there's a safer way to get current user playlists
            if (typeof (Playlist as any).getUserPlaylists === 'function') {
                playlistsArray = await (Playlist as any).getUserPlaylists();
                trace.log("Successfully used Playlist.getUserPlaylists()");
            } else if (typeof (Playlist as any).getMyPlaylists === 'function') {
                playlistsArray = await (Playlist as any).getMyPlaylists();
                trace.log("Successfully used Playlist.getMyPlaylists()");
            } else {
                // Fall back to Redux store with enhanced security filtering
                trace.log("No safer playlist API found, using Redux store with security filtering");
                return populatePlaylistListFromRedux();
            }
        } catch (error) {
            trace.err("Error using Playlist API methods:", error);
            // Fall back to Redux store with enhanced security filtering
            return populatePlaylistListFromRedux();
        }

        if (playlistsArray.length === 0) {
            playlistContainer.innerHTML = '<p style="opacity: 0.7;">No playlists found. Create some playlists first!</p>';
            return;
        }
        
        playlistContainer.innerHTML = playlistsArray
            .map((playlist: any) => `
                <label style="
                    display: flex;
                    align-items: center;
                    padding: 8px;
                    margin-bottom: 4px;
                    cursor: pointer;
                    border-radius: 4px;
                    transition: background 0.2s;
                " onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                    <input type="checkbox" 
                           data-playlist-id="${playlist.uuid || playlist.id}" 
                           style="margin-right: 12px; cursor: pointer;">
                    <div>
                        <div style="font-weight: 500;">${playlist.title || playlist.name || 'Untitled Playlist'}</div>
                        <div style="font-size: 12px; opacity: 0.7;">${playlist.numberOfTracks || playlist.trackCount || 0} tracks</div>
                    </div>
                </label>
            `).join('');
    } catch (error) {
        trace.err("Error loading playlists:", error);
        playlistContainer.innerHTML = '<p style="color: #ff6b6b;">Error loading playlists</p>';
    }
}

// Fallback function to populate playlist list from Redux with enhanced security
function populatePlaylistListFromRedux() {
    const playlistContainer = document.querySelector('#playlist-list');
    if (!playlistContainer) return;

    try {
        // Get playlists from redux store
        const state = redux.store.getState();
        const playlists = state.content?.playlists || {};

        if (Object.keys(playlists).length === 0) {
            playlistContainer.innerHTML = '<p style="opacity: 0.7;">No playlists found. Create some playlists first!</p>';
            return;
        }

        // Get current user information from the proper location based on Luna patterns
        const currentUser = state.user?.meta;
        const currentUserId = currentUser?.id;
        
        trace.log("Current user ID for playlist filtering:", currentUserId);

        const playlistsArray = Object.values(playlists).filter((playlist: any) => {
            if (!playlist || playlist.type !== 'USER') {
                return false;
            }
            
            // If we can't determine the current user, this is a critical security issue
            // In this case, we should not show any playlists to prevent data leakage
            if (!currentUserId) {
                trace.err("SECURITY WARNING: Cannot determine current user ID - not showing any playlists to prevent showing other users' playlists");
                return false;
            }
            
            // Check playlist ownership using the creator field (as seen in TidaLuna source)
            const playlistCreatorId = playlist.creator?.id;
            
            // Only return playlists that belong to the current user
            const isCurrentUserPlaylist = playlistCreatorId === currentUserId;
            
            if (!isCurrentUserPlaylist) {
                trace.log(`Filtering out playlist "${playlist.title}" - creator ID: ${playlistCreatorId}, current user ID: ${currentUserId}`);
            }
            
            return isCurrentUserPlaylist;
        });
        
        // Additional security check: if we found playlists but none belong to current user,
        // this suggests the filtering might not be working correctly
        if (Object.keys(playlists).length > 0 && playlistsArray.length === 0 && currentUserId) {
            trace.err("SECURITY WARNING: Found playlists in store but none match current user - possible data leakage prevention");
            playlistContainer.innerHTML = '<p style="color: #ff6b6b;">Unable to load your playlists. Please try again.</p>';
            return;
        }
        
        playlistContainer.innerHTML = playlistsArray
            .map((playlist: any) => `
                <label style="
                    display: flex;
                    align-items: center;
                    padding: 8px;
                    margin-bottom: 4px;
                    cursor: pointer;
                    border-radius: 4px;
                    transition: background 0.2s;
                " onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                    <input type="checkbox" 
                           data-playlist-id="${playlist.uuid}" 
                           style="margin-right: 12px; cursor: pointer;">
                    <div>
                        <div style="font-weight: 500;">${playlist.title || 'Untitled Playlist'}</div>
                        <div style="font-size: 12px; opacity: 0.7;">${playlist.numberOfTracks || 0} tracks</div>
                    </div>
                </label>
            `).join('');
    } catch (error) {
        trace.err("Error loading playlists:", error);
        playlistContainer.innerHTML = '<p style="color: #ff6b6b;">Error loading playlists</p>';
    }
}

// Function to add song to selected playlists
async function addToSelectedPlaylists(song: MediaItem) {

    const checkboxes = document.querySelectorAll('#playlist-list input[type="checkbox"]:checked');
    const selectedPlaylistIds = Array.from(checkboxes).map((cb: any) => cb.dataset.playlistId);

    if (selectedPlaylistIds.length === 0) {
        showNotification('Please select at least one playlist', 'error');
        return;
    }

    try {
        const songTitle = song.title ? await song.title() : 'Unknown Song';
        let successCount = 0;
        let errorCount = 0;

        // Add to each selected playlist
        for (const playlistId of selectedPlaylistIds) {
            try {
                // Use the Redux action helper method instead of direct dispatch
                redux.actions["content/ADD_MEDIA_ITEMS_TO_PLAYLIST"]({
                    playlistUUID: playlistId,
                    mediaItemIdsToAdd: [song.id],
                    addToIndex: -1, // Add to end
                    onDupes: "SKIP", // Skip if song already exists in playlist
                    showNotification: false // Don't show internal notifications since we handle our own
                });
                successCount++;
            } catch (error) {
                trace.err(`Error adding to playlist ${playlistId}:`, error);
                errorCount++;
            }
        }

        // Show result notification (only show errors by default)
        if (errorCount > 0) {
            const message = successCount > 0 
                ? `"${songTitle}" added to ${successCount} playlist${successCount > 1 ? 's' : ''} (${errorCount} failed)`
                : `Failed to add "${songTitle}" to playlists`;
            showNotification(message, 'error');
        }
        // Optionally show success notification (can be made configurable later)
        // else {
        //     showNotification(`"${songTitle}" added to ${successCount} playlist${successCount > 1 ? 's' : ''}`, 'success');
        // }

    } catch (error) {
        trace.err("Error adding song to playlists:", error);
        showNotification('Error adding song to playlists', 'error');
    }
}

// Function to show notification
function showNotification(message: string, type: 'success' | 'warning' | 'error') {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 8px 12px;
        border-radius: 4px;
        color: white;
        font-size: 14px;
        z-index: 10001;
        max-width: 250px;
        word-wrap: break-word;
        background: ${type === 'success' ? '#4caf50' : type === 'warning' ? '#ff9800' : '#f44336'};
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        transform: translateX(300px);
        transition: transform 0.2s ease;
        opacity: 0.9;
    `;
    notification.textContent = message;

    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 50);

    // Auto remove after 3 seconds (shorter duration)
    setTimeout(() => {
        notification.style.transform = 'translateX(300px)';
        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 200);
    }, 3000);
}

// Initialize plugin
function init() {
    // Add context menu integration
    setupContextMenuIntegration();
}

// Setup context menu integration for "Add to Multiple Playlists"
function setupContextMenuIntegration() {
    const contextMenuButton = (ContextMenu as any).addButton(unloads);
    contextMenuButton.text = "Add to Multiple Playlists";
    
    // Store the context menu song ID for use in onClick
    let contextMenuSongId: redux.ItemId | null = null;
    let contextMenuContentType: redux.ContentType = "track";
    
    contextMenuButton.onClick(async () => {
        // Close the context menu first
        redux.actions["contextMenu/CLOSE"]();
        
        // Small delay to ensure context menu is closed
        setTimeout(async () => {
            if (contextMenuSongId) {
                // Get the actual MediaItem instance for the right-clicked song
                try {
                    const mediaItem = await MediaItem.fromId(contextMenuSongId, contextMenuContentType);
                    if (mediaItem) {
                        await showPlaylistSelector(mediaItem);
                    } else {
                        showNotification('Could not load song information', 'error');
                    }
                } catch (error) {
                    trace.err("Error loading MediaItem from context menu:", error);
                    showNotification('Error loading song information', 'error');
                }
            } else {
                showNotification("No song selected", "error");
            }
        }, 100);
    });
    
    // Only show the button for media item context menus and capture the song ID
    ContextMenu.onMediaItem(unloads, async ({ mediaCollection, contextMenu }) => {
        // Store the song ID from the context menu for later use
        try {
            // Handle different types of media collections
            if (mediaCollection && typeof mediaCollection === 'object') {
                // For MediaItems collections, get the first MediaItem
                if ('mediaItems' in mediaCollection && typeof mediaCollection.mediaItems === 'function') {
                    // This is an Album or Playlist
                    const mediaItemsGenerator = await mediaCollection.mediaItems();
                    for await (const mediaItem of mediaItemsGenerator) {
                        contextMenuSongId = mediaItem.id;
                        contextMenuContentType = mediaItem.contentType;
                        break; // We only need the first one
                    }
                } else {
                    // This might be MediaItems collection - try to iterate directly
                    for await (const mediaItem of mediaCollection as any) {
                        contextMenuSongId = mediaItem.id;
                        contextMenuContentType = mediaItem.contentType;
                        break; // We only need the first one
                    }
                }
            }
        } catch (error) {
            trace.err("Error getting MediaItem from context menu:", error);
            contextMenuSongId = null;
        }
        
        // Show our button in the context menu
        await contextMenuButton.show(contextMenu);
    });
}

// Start the plugin
init();