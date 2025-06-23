/**
 * GridRush - 3D Browser Game
 * 
 * A 3D grid-based game with hand gesture controls using TensorFlow.js for hand detection
 * and Three.js for 3D rendering.
 * 
 * Features:
 * - Randomly generated levels with guaranteed paths
 * - Hand gesture controls via webcam
 * - Projectile and enemy obstacles
 * - Scoring system and lives
 */

// Game state and configuration
const GAME_CONFIG = {
    gridSize: 10,             // Size of the grid (10x10)
    tileSize: 1,              // Size of each grid tile
    initialLives: 3,          // Starting number of lives
    initialScore: 1000,       // Starting score
    stepPenalty: 10,          // Points deducted per step
    deathPenalty: 100,        // Points deducted for losing a life
    projectileSpeed: 0.03,    // Base projectile speed
    projectileInterval: 2000, // Milliseconds between projectile spawns
    enemySpeed: 0.015,        // Base enemy movement speed
    debounceTime: 300,        // Milliseconds for gesture debounce (increased for stability)
    wallPercentage: 0.2,      // Percentage of grid to fill with walls
    handDetectionInterval: 150 // Milliseconds between hand detection checks (increased to reduce CPU usage)
};

// Game state variables
let gameState = {
    score: GAME_CONFIG.initialScore,
    lives: GAME_CONFIG.initialLives,
    level: 1,
    isGameOver: false,
    isPlaying: false,
    grid: [],                 // 2D array representing the grid
    visitedTiles: new Set(),  // Set of visited tile coordinates (as strings)
    playerPosition: { x: 0, y: 0 },
    goalPosition: { x: 0, y: 0 },
    projectiles: [],          // Array of active projectiles
    enemies: [],              // Array of active enemies
    lastMoveTime: 0,          // For movement debouncing
    handDetected: false,      // Flag for hand detection status
    debugMode: false          // Debug mode to show extra information
};

// Three.js variables
let scene, camera, renderer, controls;
let gridGroup, playerMesh, goalMesh;

// TensorFlow.js and Handpose variables
let handposeModel;
let video;
let lastGesture = null;
let isHandposeModelLoaded = false;
let handDetectionErrorCount = 0; // Counter for consecutive hand detection errors
let handOverlayCanvas = null;
let handOverlayCtx = null;

// DOM elements
const startButton = document.getElementById('start-button');
const restartButton = document.getElementById('restart-button');
const webcamStatus = document.getElementById('webcam-status');
const loadingStatus = document.getElementById('loading-status');
const startOverlay = document.getElementById('start-overlay');
const gameoverOverlay = document.getElementById('gameover-overlay');
const loadingOverlay = document.getElementById('loading-overlay');
const scoreDisplay = document.getElementById('score');
const livesDisplay = document.getElementById('lives');
const levelDisplay = document.getElementById('level');
const finalScoreDisplay = document.getElementById('final-score');
const finalLevelDisplay = document.getElementById('final-level');
const canvas = document.getElementById('game-canvas');

/**
 * Initialize the game setup
 */
async function initGame() {
    // Set a maximum loading time
    window.loadingTimeoutId = setTimeout(() => {
        console.log("Loading timeout reached - forcing completion");
        try {
            loadingOverlay.classList.add('hidden');
            startOverlay.classList.remove('hidden');
            webcamStatus.textContent = 'Game loaded with limited functionality. Using keyboard controls.';
            isHandposeModelLoaded = false; // Fall back to keyboard controls
        } catch (e) {
            console.error('Error in loading timeout handler:', e);
        }
    }, 15000); // 15 seconds maximum loading time
    
    try {
        console.log('Game initialization started');
        
        // Add comprehensive error handlers 
        window.addEventListener('unhandledrejection', function(event) {
            console.error('Unhandled promise rejection:', event.reason);
            loadingStatus.textContent = 'Error: ' + event.reason;
            // Force complete loading after error
            forceCompleteLoading('Encountered an error, but continuing with limited functionality');
        });
        
        window.addEventListener('error', function(event) {
            console.error('Global error:', event.message, 'at', event.filename, ':', event.lineno);
            loadingStatus.textContent = 'Error: ' + event.message;
            // Force complete loading after error
            forceCompleteLoading('Encountered an error, but continuing with limited functionality');
        });
        
        // Function to force complete loading when stuck
        function forceCompleteLoading(message) {
            setTimeout(() => {
                try {
                    loadingOverlay.classList.add('hidden');
                    startOverlay.classList.remove('hidden');
                    webcamStatus.textContent = message || 'Game may have limited functionality. Using keyboard controls.';
                    isHandposeModelLoaded = false; // Fall back to keyboard controls
                } catch (e) {
                    console.error('Error in force complete:', e);
                }
            }, 1000);
        }
        
        
        loadingStatus.textContent = 'Setting up 3D environment...';
        setupThreeJS();
        console.log('Three.js environment set up successfully');
        
        // First check if we need to bypass webcam/handpose for debugging
        const urlParams = new URLSearchParams(window.location.search);
        const bypassHandpose = urlParams.get('bypass') === 'true';
        
        if (bypassHandpose) {
            console.log('Bypassing handpose detection for debugging');
            loadingStatus.textContent = 'Skipping hand detection (debug mode)';
            isHandposeModelLoaded = false; // Set to false to use keyboard controls
            
            // Wait a moment to show the message
            await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
            // Normal flow with handpose detection
            loadingStatus.textContent = 'Loading hand detection model...';
            try {
                await setupHandpose();
                console.log('Handpose model loaded successfully');
            } catch (handposeError) {
                console.error('Handpose setup failed:', handposeError);
                loadingStatus.textContent = 'Hand detection failed. You can still play with keyboard arrows.';
                isHandposeModelLoaded = false; // Fallback to keyboard controls
                
                // Wait a moment to show the error message
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        loadingStatus.textContent = 'Ready to play!';
        console.log('Game initialization completed');
        
        // Hide loading overlay, show start overlay
        loadingOverlay.classList.add('hidden');
        startOverlay.classList.remove('hidden');
        
        // Add event listeners
        startButton.addEventListener('click', startGame);
        restartButton.addEventListener('click', restartGame);
        
        // Set a max loading time - if we're still initializing after 10 seconds, force continue
        clearTimeout(window.loadingTimeoutId); // Clear any existing timeout
        
        // Add event listener for camera rotation with keyboard
        document.addEventListener('keydown', handleKeyboardInput);
    } catch (error) {
        console.error('Fatal error initializing game:', error);
        loadingStatus.textContent = 'Error loading game. Please try refreshing. Error: ' + error.message;
        
        // Force hide loading overlay after 5 seconds even if there's an error, for better UX
        setTimeout(() => {
            loadingOverlay.classList.add('hidden');
            startOverlay.classList.remove('hidden');
            webcamStatus.textContent = 'Game may have limited functionality. Using keyboard controls.';
        }, 5000);
    }
}

/**
 * Set up Three.js environment
 */
function setupThreeJS() {
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222233);
    
    // Create camera (positioned directly above the grid looking down)
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    // Position camera to look straight down at the grid
    const gridCenterX = GAME_CONFIG.gridSize / 2 - 0.5;
    const gridCenterZ = GAME_CONFIG.gridSize / 2 - 0.5;
    camera.position.set(gridCenterX, 18, gridCenterZ); // Higher position to see the whole grid
    camera.lookAt(gridCenterX, 0, gridCenterZ); // Look directly down
    
    // Create renderer
    renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    
    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.left = -10;
    directionalLight.shadow.camera.right = 10;
    directionalLight.shadow.camera.top = 10;
    directionalLight.shadow.camera.bottom = -10;
    scene.add(directionalLight);
    
    // Create grid group to hold all grid elements
    gridGroup = new THREE.Group();
    scene.add(gridGroup);
    
    // Improved orbit controls for camera rotation
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.rotateSpeed = 0.5;
    controls.enableZoom = true; // Allow zooming
    controls.enablePan = true;  // Allow panning
    controls.minPolarAngle = 0; // Allow full vertical rotation (can look straight down)
    controls.maxPolarAngle = Math.PI / 2; // Restrict to not go below horizon
    controls.enabled = false;   // Disabled by default, enabled by right-click
    
    // Handle window resize
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
    
    // Add mouse controls for camera
    setupCameraControls();
}

/**
 * Set up Handpose model and webcam
 */
async function setupHandpose() {
    try {
        console.log('Setting up webcam access');
        video = document.getElementById('webcam');
        
        if (!video) {
            console.error('Webcam video element not found');
            throw new Error('Webcam video element not found');
        }
        
        // Try to access webcam with shorter timeout
        let stream;
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Browser does not support getUserMedia');
            }
            
            const streamPromise = navigator.mediaDevices.getUserMedia({
                video: {
                    width: 640,
                    height: 480,
                    facingMode: 'user'
                }
            });
            
            // Set a timeout for webcam access
            const webcamTimeout = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Webcam access timed out')), 8000)
            );
            
            stream = await Promise.race([streamPromise, webcamTimeout]);
            video.srcObject = stream;
            console.log('Webcam access granted');
        } catch (webcamError) {
            console.error('Webcam access error:', webcamError);
            webcamStatus.textContent = 'Cannot access webcam. Will use keyboard controls.';
            video.style.display = 'none'; // Hide video element if webcam fails
            throw new Error('Webcam access issue: ' + webcamError.message);
        }
        
        // Wait for video to be loaded with timeout
        return new Promise((resolve, reject) => {
            // Set a timeout in case video loading hangs
            const timeout = setTimeout(() => {
                console.error('Video loading timed out');
                reject(new Error('Video loading timed out'));
            }, 8000); // 8 second timeout
            
            video.onloadedmetadata = async () => {
                clearTimeout(timeout); // Clear the timeout as video loaded
                
                try {
                    await video.play();
                    webcamStatus.textContent = 'Loading hand detection model...';
                    console.log('Loading handpose model...');
                    
                    // Set another timeout for model loading
                    const modelPromise = handpose.load();
                    const modelTimeout = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Handpose model loading timed out')), 10000)
                    );
                    
                    // Race between model loading and timeout
                    handposeModel = await Promise.race([modelPromise, modelTimeout]);
                    
                    isHandposeModelLoaded = true;
                    webcamStatus.textContent = 'Webcam ready! Point your hand at the camera.';
                    console.log('Handpose model loaded successfully');
                    
                    // Start hand detection
                    detectHands();
                    resolve();
                } catch (modelError) {
                    console.error('Error loading handpose model:', modelError);
                    webcamStatus.textContent = 'Hand detection unavailable. Using keyboard controls.';
                    
                    // Show hand indicator elements with failure state
                    const handIndicator = document.getElementById('hand-indicator');
                    if (handIndicator) {
                        handIndicator.textContent = "Using Keyboard Controls";
                        handIndicator.className = "not-detected";
                    }
                    
                    reject(modelError);
                }
            };
            
            // Handle video errors
            video.onerror = (err) => {
                clearTimeout(timeout);
                console.error('Video error:', err);
                reject(new Error('Video error: ' + err));
            };
        });
    } catch (error) {
        console.error('Error setting up webcam or Handpose:', error);
        webcamStatus.textContent = 'Error with webcam or hand detection. Using keyboard controls.';
        throw error;
    }
}

/**
 * Start the hand detection loop
 */
async function detectHands() {
    // Get indicator elements
    const handIndicator = document.getElementById('hand-indicator');
    const gestureIndicator = document.getElementById('gesture-indicator');
    
    // Make sure overlay is initialized if not already
    if (!handOverlayCanvas) {
        initHandOverlay();
    }
    
    // If model not loaded or too many errors, use keyboard controls
    if (!isHandposeModelLoaded) {
        if (handIndicator) {
            handIndicator.textContent = "Using Keyboard Controls";
            handIndicator.className = "not-detected";
        }
        
        if (gestureIndicator) gestureIndicator.style.display = 'none'; // Hide gesture indicator
        
        // Clear the overlay canvas if it exists
        if (handOverlayCtx && handOverlayCanvas) {
            try {
                handOverlayCtx.clearRect(0, 0, handOverlayCanvas.width, handOverlayCanvas.height);
            } catch (e) {
                console.log("Error clearing overlay canvas:", e);
            }
        }
        
        // Don't continue the detection loop if model is not loaded
        return;
    }
    
    if (handDetectionErrorCount > 5) {
        console.log('Too many hand detection errors, disabling hand detection');
        if (handIndicator) {
            handIndicator.textContent = "Detection Disabled";
            handIndicator.className = "not-detected";
        }
        
        if (gestureIndicator) gestureIndicator.style.display = 'none';
        
        // Clear the overlay canvas
        if (handOverlayCtx) {
            handOverlayCtx.clearRect(0, 0, handOverlayCanvas.width, handOverlayCanvas.height);
        }
        
        isHandposeModelLoaded = false; // Disable hand detection
        return;
    }
    
    try {
        // Only run detection if video is ready and playing
        if (video.readyState === 4) {
            const hands = await handposeModel.estimateHands(video);
            
            // Reset error count on successful detection
            handDetectionErrorCount = 0;
            
            // Clear previous gesture indicators
            if (gestureIndicator) {
                const arrows = gestureIndicator.querySelectorAll('.arrow');
                arrows.forEach(arrow => arrow.style.opacity = '0.3');
            }
            
            // Clear the overlay canvas
            if (handOverlayCtx) {
                handOverlayCtx.clearRect(0, 0, handOverlayCanvas.width, handOverlayCanvas.height);
            }
            
            // No hand detected - clear state and update UI
            if (hands.length === 0) {
                gameState.handDetected = false;
                lastGesture = null; // Reset gesture when hand disappears
                
                if (handIndicator) {
                    handIndicator.textContent = "No Hand Detected";
                    handIndicator.className = "not-detected";
                }
                
                // Continue the detection loop
                setTimeout(detectHands, GAME_CONFIG.handDetectionInterval);
                return;
            }
            
            // Hand detected - analyze gesture
            const hand = hands[0];
            
            // Get landmarks for all fingers and wrist
            const indexTip = hand.annotations.indexFinger[3]; 
            const indexMid = hand.annotations.indexFinger[2];
            const indexBase = hand.annotations.indexFinger[0];
            const middleTip = hand.annotations.middleFinger[3];
            const ringTip = hand.annotations.ringFinger[3];
            const pinkyTip = hand.annotations.pinky[3];
            const thumbTip = hand.annotations.thumb[3];
            const wrist = hand.landmarks[0];
            
            // Calculate how extended each finger is (distance from tip to wrist)
            const indexDistance = Math.hypot(indexTip[0] - wrist[0], indexTip[1] - wrist[1]);
            const middleDistance = Math.hypot(middleTip[0] - wrist[0], middleTip[1] - wrist[1]);
            const ringDistance = Math.hypot(ringTip[0] - wrist[0], ringTip[1] - wrist[1]);
            const pinkyDistance = Math.hypot(pinkyTip[0] - wrist[0], pinkyTip[1] - wrist[1]);
            
            // Check if middle, ring and pinky fingers are curled (distance from tip to base is short)
            // Make these thresholds more lenient to better detect different hand sizes
            const middleCurled = middleDistance < 70;
            const ringCurled = ringDistance < 70;
            const pinkyCurled = pinkyDistance < 70;
            
            // Angle between index finger segments
            const indexBaseToMidX = indexMid[0] - indexBase[0];
            const indexBaseToMidY = indexMid[1] - indexBase[1];
            const indexMidToTipX = indexTip[0] - indexMid[0];
            const indexMidToTipY = indexTip[1] - indexMid[1]; 
            
            // Dot product to measure straightness of finger
            const dotProduct = (indexBaseToMidX * indexMidToTipX + indexBaseToMidY * indexMidToTipY);
            const mag1 = Math.sqrt(indexBaseToMidX**2 + indexBaseToMidY**2);
            const mag2 = Math.sqrt(indexMidToTipX**2 + indexMidToTipY**2);
            const straightness = dotProduct / (mag1 * mag2); // 1 is straight, <0 is bent back
            
            // Determine if index is clearly extended and straight
            const indexExtended = indexDistance > 60 && straightness > 0.6; // Make this more lenient
            
            // Calculate the normalized length of the index finger compared to the distance from wrist to middle finger
            const indexToMiddleRatio = indexDistance / (middleDistance || 1);
            
            // A hand is considered "open" for control when:
            // 1. Index finger is clearly extended and straighter
            // 2. OR index is significantly longer than other fingers (also indicates pointing)
            // This is more lenient than requiring all other fingers to be perfectly curled
            const handOpen = (indexExtended && (middleCurled || ringCurled || pinkyCurled)) || 
                             (indexToMiddleRatio > 1.3); // Index is significantly longer than middle
            
            // Update hand state UI
            gameState.handDetected = true;
            
            // Debug information to help see what values are being measured
            if (handIndicator) {
                const debugInfo = gameState.debugMode ? ` (i:${indexDistance.toFixed(1)}, str:${straightness.toFixed(2)})` : '';
                handIndicator.textContent = handOpen ? 
                    `Hand Detected (Open)${debugInfo}` : 
                    `Hand Detected (Closed)${debugInfo}`;
                handIndicator.className = handOpen ? "detected" : "not-detected";
            }
            
            // Draw the hand skeleton on the overlay with appropriate color
            drawHandSkeleton(hand.landmarks, handOpen);
            
            // If hand is closed, don't register any movement
            if (!handOpen) {
                // IMPORTANT: Reset last gesture when hand is closed to prevent lingering movement
                lastGesture = null;
                
                // Continue detection loop without processing gestures
                setTimeout(detectHands, GAME_CONFIG.handDetectionInterval);
                return;
            }
            
            // If we reach here, the hand is open - continue with gesture processing
            
            // Calculate direction vector from wrist to index finger tip
            // This gives us the pointing direction
            const directionX = indexTip[0] - wrist[0];
            const directionY = indexTip[1] - wrist[1];
            
            // Calculate magnitude of pointing gesture
            const magnitude = Math.sqrt(directionX * directionX + directionY * directionY);
            
            // Higher threshold for more definitive pointing gestures
            const confidenceThreshold = 60;  // Increased for more certainty
            
            let gesture = null;
            
            if (magnitude > confidenceThreshold) {
                // Determine primary direction with a stronger bias (1.8 instead of 1.5)
                // This makes the direction detection less sensitive to small movements
                if (Math.abs(directionX) > Math.abs(directionY) * 1.8) {
                    // Horizontal movement is stronger
                    gesture = directionX > 0 ? 'right' : 'left';
                } else if (Math.abs(directionY) > Math.abs(directionX) * 1.8) {
                    // Vertical movement is stronger
                    gesture = directionY > 0 ? 'down' : 'up'; // Y is inverted in the video
                }
                
                // Highlight the active direction arrow if a direction is detected
                if (gestureIndicator && gesture) {
                    const arrowClass = `arrow-${gesture}`;
                    const activeArrow = gestureIndicator.querySelector(`.${arrowClass}`);
                    if (activeArrow) {
                        activeArrow.style.opacity = '1';
                        activeArrow.style.transform = 'scale(1.5)';
                        setTimeout(() => {
                            activeArrow.style.transform = 'scale(1)';
                        }, 200);
                    }
                }
                
                // Process movement with a longer debounce time to prevent fast repeated movements
                const currentTime = Date.now();
                const increasedDebounceTime = GAME_CONFIG.debounceTime * 2; // 400ms instead of 200ms
                
                if (gesture && gesture !== lastGesture && currentTime - gameState.lastMoveTime > increasedDebounceTime) {
                    handleMovement(gesture);
                    lastGesture = gesture;
                    gameState.lastMoveTime = currentTime;
                    
                    // Visual feedback for successful gesture recognition
                    if (handIndicator) {
                        const originalText = handIndicator.textContent;
                        handIndicator.textContent = `Moving ${gesture}`;
                        setTimeout(() => {
                            handIndicator.textContent = originalText;
                        }, 500);
                    }
                }
            } else {
                // Magnitude not strong enough - consider as no distinct direction
                // Don't update lastGesture here to avoid unintended gesture cancellations
            }
        }
    } catch (error) {
        console.error('Error in hand detection:', error);
        handDetectionErrorCount++;
        
        if (handIndicator) {
            handIndicator.textContent = `Detection Error (${handDetectionErrorCount}/5)`;
            handIndicator.className = "not-detected";
        }
    }
    
    // Continue detection loop if we haven't had too many errors
    if (handDetectionErrorCount <= 5) {
        setTimeout(detectHands, GAME_CONFIG.handDetectionInterval);
    }
}

/**
 * Handle player movement based on gesture
 * @param {string} direction - Movement direction ('up', 'down', 'left', 'right')
 */
function handleMovement(direction) {
    if (gameState.isGameOver || !gameState.isPlaying) return;
    
    const { x, y } = gameState.playerPosition;
    let newX = x;
    let newY = y;
    
    // Calculate new position based on direction
    switch (direction) {
        case 'up': 
            newY = y - 1;
            break;
        case 'down': 
            newY = y + 1;
            break;
        case 'left': 
            newX = x - 1;
            break;
        case 'right': 
            newX = x + 1;
            break;
        default:
            return;
    }
    
    // Check if move is valid
    if (isValidMove(newX, newY)) {
        // Update score for each step
        gameState.score -= GAME_CONFIG.stepPenalty;
        updateScoreDisplay();
        
        // Update player position
        gameState.playerPosition = { x: newX, y: newY };
        updatePlayerPosition();
        
        // Mark tile as visited
        const tileKey = `${newX},${newY}`;
        gameState.visitedTiles.add(tileKey);
        
        // Check if player reached the goal
        if (newX === gameState.goalPosition.x && newY === gameState.goalPosition.y) {
            handleLevelComplete();
        }
    }
}

/**
 * Check if a move to (x, y) is valid
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @returns {boolean} - True if move is valid
 */
function isValidMove(x, y) {
    // Check if within grid boundaries
    if (x < 0 || y < 0 || x >= GAME_CONFIG.gridSize || y >= GAME_CONFIG.gridSize) {
        return false;
    }
    
    // Check if hitting a wall
    if (gameState.grid[y][x] === 1) {
        handleCollision('wall');
        return false;
    }
    
    // From level 2 onward, check if tile was already visited
    if (gameState.level >= 2) {
        const tileKey = `${x},${y}`;
        if (gameState.visitedTiles.has(tileKey)) {
            return false;
        }
    }
    
    return true;
}

/**
 * Handle collisions with obstacles
 * @param {string} type - Type of collision ('wall', 'projectile', 'enemy')
 */
function handleCollision(type) {
    // Reduce lives
    gameState.lives--;
    updateLivesDisplay();
    
    // Apply score penalty
    gameState.score -= GAME_CONFIG.deathPenalty;
    updateScoreDisplay();
    
    // Check if game over
    if (gameState.lives <= 0) {
        gameOver();
        return;
    }
    
    // Visual feedback for collision
    const originalColor = playerMesh.material.color.getHex();
    playerMesh.material.color.set(0xff0000); // Flash red
    
    setTimeout(() => {
        playerMesh.material.color.setHex(originalColor);
    }, 200);
}

/**
 * Update player position in the 3D scene
 */
function updatePlayerPosition() {
    const { x, y } = gameState.playerPosition;
    playerMesh.position.set(
        x * GAME_CONFIG.tileSize,
        0.5, // Half the height of the cube
        y * GAME_CONFIG.tileSize
    );
}

/**
 * Update score display in the HUD
 */
function updateScoreDisplay() {
    scoreDisplay.textContent = Math.max(0, gameState.score);
}

/**
 * Update lives display in the HUD
 */
function updateLivesDisplay() {
    livesDisplay.textContent = gameState.lives;
}

/**
 * Update level display in the HUD
 */
function updateLevelDisplay() {
    levelDisplay.textContent = gameState.level;
}

/**
 * Handle level completion
 */
function handleLevelComplete() {
    gameState.level++;
    updateLevelDisplay();
    
    // Show level complete message
    const levelCompleteMessage = document.createElement('div');
    levelCompleteMessage.className = 'instruction';
    levelCompleteMessage.textContent = `Level ${gameState.level - 1} Complete!`;
    document.getElementById('game-container').appendChild(levelCompleteMessage);
    
    // Remove message after animation
    setTimeout(() => {
        document.getElementById('game-container').removeChild(levelCompleteMessage);
    }, 5000);
    
    // Generate new level with increased difficulty
    generateLevel();
}

/**
 * Generate a new level
 */
function generateLevel() {
    // Clear existing grid elements
    while (gridGroup.children.length > 0) {
        gridGroup.remove(gridGroup.children[0]);
    }
    
    // Reset game state for new level
    gameState.grid = [];
    gameState.visitedTiles = new Set();
    gameState.projectiles = [];
    gameState.enemies = [];
    
    // Generate new grid using maze generation with guaranteed path
    generateGrid();
    
    // Place player at start position (0,0)
    gameState.playerPosition = { x: 0, y: 0 };
    gameState.visitedTiles.add('0,0'); // Mark starting position as visited
    
    // Create and position 3D objects
    createGridObjects();
    updatePlayerPosition();
    
    // Show new level message
    const newLevelMessage = document.createElement('div');
    newLevelMessage.className = 'instruction';
    newLevelMessage.textContent = `Level ${gameState.level}`;
    document.getElementById('game-container').appendChild(newLevelMessage);
    
    // Remove message after animation
    setTimeout(() => {
        try {
            document.getElementById('game-container').removeChild(newLevelMessage);
        } catch (e) {
            console.log('Element already removed');
        }
    }, 5000);
}

/**
 * Generate the grid with walls and a guaranteed path
 * Uses an enhanced maze generation algorithm with intelligent obstacles
 */
function generateGrid() {
    const size = GAME_CONFIG.gridSize;
    
    // Initialize grid with all empty (0)
    for (let y = 0; y < size; y++) {
        const row = [];
        for (let x = 0; x < size; x++) {
            row.push(0); // 0 represents an empty tile
        }
        gameState.grid.push(row);
    }
    
    // Set start position
    const startX = 0;
    const startY = 0;
    
    // Set goal position based on level with more variety
    if (gameState.level === 1) {
        gameState.goalPosition = { x: 4, y: 4 }; // Easier first level
    } else if (gameState.level === 2) {
        gameState.goalPosition = { x: size - 2, y: 2 }; // Right side
    } else if (gameState.level === 3) {
        gameState.goalPosition = { x: 2, y: size - 2 }; // Bottom side
    } else if (gameState.level === 4) {
        gameState.goalPosition = { x: size - 3, y: size - 3 }; // Bottom right
    } else {
        // Higher levels have truly random goal positions (but not too close to start)
        let minDistance = Math.floor(size * 0.6); // Minimum Manhattan distance from start
        
        let x, y;
        do {
            x = Math.floor(Math.random() * (size - 2)) + 1;
            y = Math.floor(Math.random() * (size - 2)) + 1;
            
            // Calculate Manhattan distance
            const distance = Math.abs(x - startX) + Math.abs(y - startY);
            if (distance >= minDistance) break;
        } while (true);
        
        gameState.goalPosition = { x, y };
    }
    
    // Create the maze based on the level
    if (gameState.level <= 2) {
        // Lower levels: Create a simple maze with a clear path and some obstacles
        generateSimpleMaze(startX, startY, gameState.goalPosition.x, gameState.goalPosition.y);
    } else {
        // Higher levels: Create a more complex maze with strategic obstacles
        generateComplexMaze(startX, startY, gameState.goalPosition.x, gameState.goalPosition.y);
    }
    
    // Always ensure start and goal positions are open
    gameState.grid[startY][startX] = 0; // Start position
    gameState.grid[gameState.goalPosition.y][gameState.goalPosition.x] = 0; // Goal position
    
    // Make sure there's still a valid path (redundant check)
    validatePath(startX, startY, gameState.goalPosition.x, gameState.goalPosition.y);
}

/**
 * Generate a simple maze for lower levels
 * @param {number} startX - Starting X coordinate
 * @param {number} startY - Starting Y coordinate
 * @param {number} endX - Ending X coordinate
 * @param {number} endY - Ending Y coordinate
 */
function generateSimpleMaze(startX, startY, endX, endY) {
    const size = GAME_CONFIG.gridSize;
    
    // Find the shortest path first
    const path = findPath(startX, startY, endX, endY);
    
    // Draw some walls around the path with gaps
    if (path.length > 0) {
        // Mark the path tiles as visited
        const visited = new Set();
        for (const point of path) {
            visited.add(`${point.x},${point.y}`);
        }
        
        // Create walls but leave the path clear
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                // Don't put walls on the path
                if (visited.has(`${x},${y}`)) continue;
                
                // Avoid blocking the start and goal areas completely
                if ((x < 2 && y < 2) || (Math.abs(x - endX) < 2 && Math.abs(y - endY) < 2)) continue;
                
                // Create patterns of walls based on level
                if (gameState.level === 1) {
                    // Level 1: Simple walls pattern
                    if ((x + y) % 3 === 0) {
                        gameState.grid[y][x] = 1;
                    }
                } else {
                    // Level 2: More challenging pattern
                    if ((x * y) % 4 === 0 || (x + y) % 5 === 0) {
                        gameState.grid[y][x] = 1;
                    }
                }
            }
        }
        
        // Add some strategic walls near the path to make navigation more challenging
        for (let i = 1; i < path.length - 1; i++) {
            const point = path[i];
            
            // Try to place walls adjacent to the path points (but not on path)
            const adjacentPoints = [
                { x: point.x + 1, y: point.y },
                { x: point.x - 1, y: point.y },
                { x: point.x, y: point.y + 1 },
                { x: point.x, y: point.y - 1 }
            ];
            
            for (const adjPoint of adjacentPoints) {
                if (adjPoint.x < 0 || adjPoint.x >= size || adjPoint.y < 0 || adjPoint.y >= size) continue;
                if (visited.has(`${adjPoint.x},${adjPoint.y}`)) continue;
                
                // 50% chance to place a wall
                if (Math.random() < 0.5) {
                    gameState.grid[adjPoint.y][adjPoint.x] = 1;
                }
            }
        }
    }
}

/**
 * Generate a complex maze for higher levels
 * @param {number} startX - Starting X coordinate
 * @param {number} startY - Starting Y coordinate
 * @param {number} endX - Ending X coordinate
 * @param {number} endY - Ending Y coordinate
 */
function generateComplexMaze(startX, startY, endX, endY) {
    const size = GAME_CONFIG.gridSize;
    
    // Choose a maze style based on level
    const mazeStyle = (gameState.level % 3);
    
    switch (mazeStyle) {
        case 0:
            // Maze style 1: Room-based maze with bottlenecks
            generateRoomMaze(startX, startY, endX, endY);
            break;
            
        case 1:
            // Maze style 2: Spiral/concentric maze
            generateSpiralMaze(startX, startY, endX, endY);
            break;
            
        case 2:
            // Maze style 3: Long winding path with strategic walls
            generateWindingMaze(startX, startY, endX, endY);
            break;
    }
}

/**
 * Generate a room-based maze with bottlenecks
 */
function generateRoomMaze(startX, startY, endX, endY) {
    const size = GAME_CONFIG.gridSize;
    
    // Create some room divisions (3x3 grid of rooms)
    const roomSize = Math.floor(size / 3);
    
    // Create dividing walls
    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            // Create walls at room boundaries
            if (x % roomSize === 0 || y % roomSize === 0) {
                gameState.grid[y][x] = 1;
            }
        }
    }
    
    // Create doors between rooms (at least one door per wall)
    for (let roomY = 0; roomY < 3; roomY++) {
        for (let roomX = 0; roomX < 3; roomX++) {
            // Horizontal doors (in vertical walls)
            if (roomX < 2) {
                const doorY = (roomY * roomSize) + Math.floor(Math.random() * (roomSize - 2)) + 1;
                const doorX = (roomX + 1) * roomSize;
                gameState.grid[doorY][doorX] = 0;
            }
            
            // Vertical doors (in horizontal walls)
            if (roomY < 2) {
                const doorX = (roomX * roomSize) + Math.floor(Math.random() * (roomSize - 2)) + 1;
                const doorY = (roomY + 1) * roomSize;
                gameState.grid[doorY][doorX] = 0;
            }
        }
    }
    
    // Add some random obstacles inside rooms
    for (let roomY = 0; roomY < 3; roomY++) {
        for (let roomX = 0; roomX < 3; roomX++) {
            const obstacleCount = Math.floor(Math.random() * 3) + 2; // 2-4 obstacles per room
            
            for (let i = 0; i < obstacleCount; i++) {
                const obsX = (roomX * roomSize) + Math.floor(Math.random() * (roomSize - 2)) + 1;
                const obsY = (roomY * roomSize) + Math.floor(Math.random() * (roomSize - 2)) + 1;
                
                // Don't block start or goal
                if ((obsX === startX && obsY === startY) || (obsX === endX && obsY === endY)) {
                    continue;
                }
                
                gameState.grid[obsY][obsX] = 1;
                
                // Sometimes create small clusters of obstacles
                if (Math.random() < 0.4) {
                    const adjX = obsX + (Math.random() < 0.5 ? 1 : -1);
                    const adjY = obsY;
                    
                    if (adjX > 0 && adjX < size && adjX % roomSize !== 0 && 
                        !(adjX === startX && adjY === startY) && 
                        !(adjX === endX && adjY === endY)) {
                        gameState.grid[adjY][adjX] = 1;
                    }
                }
            }
        }
    }
    
    // Make sure there's a path from start to goal
    validatePath(startX, startY, endX, endY);
}

/**
 * Generate a spiral/concentric maze
 */
function generateSpiralMaze(startX, startY, endX, endY) {
    const size = GAME_CONFIG.gridSize;
    const center = Math.floor(size / 2);
    
    // Create concentric squares
    const rings = Math.floor(size / 2);
    
    for (let ring = 1; ring <= rings; ring++) {
        // Define the boundaries of this ring
        const minX = center - ring;
        const maxX = center + ring;
        const minY = center - ring;
        const maxY = center + ring;
        
        // Create walls for this ring
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                // Only process points on the ring border
                if (x === minX || x === maxX || y === minY || y === maxY) {
                    // Check boundaries
                    if (x >= 0 && x < size && y >= 0 && y < size) {
                        // Don't block start or goal
                        if ((x === startX && y === startY) || (x === endX && y === endY)) {
                            continue;
                        }
                        
                        // Create walls with 70% probability (leave some gaps)
                        if (Math.random() < 0.7) {
                            gameState.grid[y][x] = 1;
                        }
                    }
                }
            }
        }
        
        // Ensure there's at least one opening in each wall of the ring
        // Top wall
        let openingX = minX + Math.floor(Math.random() * (maxX - minX));
        if (openingX >= 0 && openingX < size && minY >= 0 && minY < size) {
            gameState.grid[minY][openingX] = 0;
        }
        
        // Right wall
        let openingY = minY + Math.floor(Math.random() * (maxY - minY));
        if (maxX >= 0 && maxX < size && openingY >= 0 && openingY < size) {
            gameState.grid[openingY][maxX] = 0;
        }
        
        // Bottom wall
        openingX = minX + Math.floor(Math.random() * (maxX - minX));
        if (openingX >= 0 && openingX < size && maxY >= 0 && maxY < size) {
            gameState.grid[maxY][openingX] = 0;
        }
        
        // Left wall
        openingY = minY + Math.floor(Math.random() * (maxY - minY));
        if (minX >= 0 && minX < size && openingY >= 0 && openingY < size) {
            gameState.grid[openingY][minX] = 0;
        }
    }
    
    // Make sure there's a path from start to goal
    validatePath(startX, startY, endX, endY);
}

/**
 * Generate a winding maze with strategic walls
 */
function generateWindingMaze(startX, startY, endX, endY) {
    const size = GAME_CONFIG.gridSize;
    
    // Find a winding path from start to goal
    const directPath = findPath(startX, startY, endX, endY);
    
    // Create a more winding path by adding random detours
    let windingPath = [];
    
    if (directPath.length > 0) {
        windingPath = createWindingPath(directPath);
        
        // Mark all path tiles
        const pathTiles = new Set();
        for (const point of windingPath) {
            pathTiles.add(`${point.x},${point.y}`);
        }
        
        // Fill a significant portion of the grid with walls
        const wallDensity = 0.5 + (gameState.level * 0.03); // Increases with level
        
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                // Don't put walls on the path
                if (pathTiles.has(`${x},${y}`)) continue;
                
                // Don't completely surround start and end
                if ((Math.abs(x - startX) <= 1 && Math.abs(y - startY) <= 1) ||
                    (Math.abs(x - endX) <= 1 && Math.abs(y - endY) <= 1)) {
                    continue;
                }
                
                // Place walls based on probability
                if (Math.random() < wallDensity) {
                    gameState.grid[y][x] = 1;
                }
            }
        }
        
        // Add some strategic walls along the path to create challenges
        // (but keep the path itself clear)
        for (let i = 2; i < windingPath.length - 2; i++) {
            const point = windingPath[i];
            const adjacentPoints = [
                { x: point.x + 1, y: point.y },
                { x: point.x - 1, y: point.y },
                { x: point.x, y: point.y + 1 },
                { x: point.x, y: point.y - 1 }
            ];
            
            for (const adjPoint of adjacentPoints) {
                // Check if in bounds and not on path
                if (adjPoint.x < 0 || adjPoint.x >= size || adjPoint.y < 0 || adjPoint.y >= size) continue;
                if (pathTiles.has(`${adjPoint.x},${adjPoint.y}`)) continue;
                
                // Add walls strategically
                if (Math.random() < 0.65) {
                    gameState.grid[adjPoint.y][adjPoint.x] = 1;
                }
            }
        }
    }
    
    // Make sure there's a path from start to goal
    validatePath(startX, startY, endX, endY);
}

/**
 * Create a winding path from a direct path by adding detours
 * @param {Array} directPath - The direct path from start to goal
 * @returns {Array} - A more winding path
 */
function createWindingPath(directPath) {
    const windingPath = [...directPath];
    const size = GAME_CONFIG.gridSize;
    
    // No need to add detours to very short paths
    if (directPath.length < 5) return windingPath;
    
    // Add 1-3 detours depending on path length
    const numDetours = Math.min(3, Math.floor(directPath.length / 5));
    
    for (let d = 0; d < numDetours; d++) {
        // Choose a random point on the path (not too close to start or goal)
        const minIndex = Math.ceil(directPath.length * 0.2);
        const maxIndex = Math.floor(directPath.length * 0.8);
        const detourIndex = minIndex + Math.floor(Math.random() * (maxIndex - minIndex));
        
        const detourStart = directPath[detourIndex];
        
        // Choose a random valid detour point
        let detourX, detourY;
        const detourLength = Math.floor(Math.random() * 3) + 2; // 2-4 steps
        
        // Try a few directions for the detour
        const directions = [
            { x: 1, y: 0 },
            { x: -1, y: 0 },
            { x: 0, y: 1 },
            { x: 0, y: -1 }
        ];
        
        // Shuffle directions
        for (let i = directions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [directions[i], directions[j]] = [directions[j], directions[i]];
        }
        
        // Try each direction until we find a valid detour
        for (const dir of directions) {
            let validDetour = true;
            let currentX = detourStart.x;
            let currentY = detourStart.y;
            const detourPoints = [];
            
            // Check if we can make a detour in this direction
            for (let step = 0; step < detourLength; step++) {
                currentX += dir.x;
                currentY += dir.y;
                
                // Check if the detour point is valid
                if (currentX < 0 || currentX >= size || currentY < 0 || currentY >= size) {
                    validDetour = false;
                    break;
                }
                
                detourPoints.push({ x: currentX, y: currentY });
            }
            
            // If we found a valid detour, add it to the path
            if (validDetour) {
                // Add detour points
                const detourBackPoints = [...detourPoints];
                detourBackPoints.pop(); // Remove the last point to avoid duplication
                detourBackPoints.reverse(); // Reverse to come back to the original path
                
                // Insert the detour into the winding path
                windingPath.splice(detourIndex + 1, 0, ...detourPoints, ...detourBackPoints);
                break;
            }
        }
    }
    
    return windingPath;
}

/**
 * Find a path from start to end using A* algorithm
 * @param {number} startX - Starting X coordinate
 * @param {number} startY - Starting Y coordinate
 * @param {number} endX - Ending X coordinate
 * @param {number} endY - Ending Y coordinate
 * @returns {Array} - Array of points in the path
 */
function findPath(startX, startY, endX, endY) {
    const size = GAME_CONFIG.gridSize;
    
    // Create a copy of the grid for pathfinding
    const gridCopy = [];
    for (let y = 0; y < gameState.grid.length; y++) {
        gridCopy[y] = [...gameState.grid[y]];
    }
    
    // Mark all cells as unvisited
    const visited = Array(size).fill().map(() => Array(size).fill(false));
    
    // Use A* pathfinding to find a path
    const openSet = [{ x: startX, y: startY, g: 0, h: 0, f: 0, parent: null }];
    const closedSet = [];
    
    while (openSet.length > 0) {
        // Find node with lowest f score
        let lowestIndex = 0;
        for (let i = 0; i < openSet.length; i++) {
            if (openSet[i].f < openSet[lowestIndex].f) {
                lowestIndex = i;
            }
        }
        
        const current = openSet[lowestIndex];
        
        // If reached the end
        if (current.x === endX && current.y === endY) {
            // Reconstruct path
            const path = [];
            let temp = current;
            while (temp !== null) {
                path.push({ x: temp.x, y: temp.y });
                temp = temp.parent;
            }
            return path.reverse();
        }
        
        // Remove current from openSet and add to closedSet
        openSet.splice(lowestIndex, 1);
        closedSet.push(current);
        visited[current.y][current.x] = true;
        
        // Check all adjacent neighbors
        const directions = [
            { x: 1, y: 0 },  // Right
            { x: -1, y: 0 }, // Left
            { x: 0, y: 1 },  // Down
            { x: 0, y: -1 }  // Up
        ];
        
        for (const dir of directions) {
            const neighborX = current.x + dir.x;
            const neighborY = current.y + dir.y;
            
            // Check if valid position
            if (neighborX < 0 || neighborX >= size || neighborY < 0 || neighborY >= size) {
                continue;
            }
            
            // Skip if wall or in closed set
            if (gridCopy[neighborY][neighborX] === 1 || visited[neighborY][neighborX]) {
                continue;
            }
            
            // Calculate scores
            const g = current.g + 1;
            const h = Math.abs(neighborX - endX) + Math.abs(neighborY - endY); // Manhattan distance
            const f = g + h;
            
            // Check if already in openSet with better score
            let inOpenSet = false;
            for (const node of openSet) {
                if (node.x === neighborX && node.y === neighborY) {
                    inOpenSet = true;
                    if (g < node.g) {
                        node.g = g;
                        node.f = f;
                        node.parent = current;
                    }
                    break;
                }
            }
            
            // If not in openSet, add it
            if (!inOpenSet) {
                openSet.push({
                    x: neighborX,
                    y: neighborY,
                    g: g,
                    h: h,
                    f: f,
                    parent: current
                });
            }
        }
    }
    
    // No path found
    return [];
}

/**
 * Validate that there is a path from start to goal
 * If no path is found, create one
 * @param {number} startX - Starting X coordinate
 * @param {number} startY - Starting Y coordinate
 * @param {number} endX - Ending X coordinate
 * @param {number} endY - Ending Y coordinate
 */
function validatePath(startX, startY, endX, endY) {
    const path = findPath(startX, startY, endX, endY);
    
    // If no path is found, create a direct path
    if (path.length === 0) {
        console.log("No path found, creating one...");
        
        // Clear a direct path
        const dx = endX > startX ? 1 : -1;
        const dy = endY > startY ? 1 : -1;
        
        // First horizontal then vertical
        let x = startX;
        while (x !== endX) {
            gameState.grid[startY][x] = 0;
            x += dx;
        }
        
        let y = startY;
        while (y !== endY) {
            gameState.grid[y][endX] = 0;
            y += dy;
        }
        
        // Make sure the end is clear
        gameState.grid[endY][endX] = 0;
    }
}

/**
 * Check if WebGL is available
 */
function checkWebGL() {
    try {
        const canvas = document.createElement('canvas');
        return !!window.WebGLRenderingContext && 
            (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
    } catch(e) {
        return false;
    }
}

/**
 * Start the game
 */
function startGame() {
    console.log('Starting game');
    
    // Hide start overlay
    startOverlay.classList.add('hidden');
    
    // Initialize game state
    gameState.isPlaying = true;
    gameState.isGameOver = false;
    gameState.score = GAME_CONFIG.initialScore;
    gameState.lives = GAME_CONFIG.initialLives;
    gameState.level = 1;
    
    // Initialize hand overlay after DOM is fully loaded and webcam is visible
    setTimeout(() => {
        // Initialize hand overlay canvas for visual feedback
        try {
            console.log('Initializing hand overlay...');
            initHandOverlay(); 
            console.log('Hand overlay initialization complete');
        } catch (e) {
            console.error('Error initializing hand overlay:', e);
        }
    }, 1500);
    
    // Update displays
    updateScoreDisplay();
    updateLivesDisplay();
    updateLevelDisplay();
    
    // Generate first level
    generateLevel();
    
    // Start game loop
    animate();
    
    // Show game instructions
    const instruction = document.createElement('div');
    instruction.className = 'instruction';
    instruction.textContent = 'Open hand with extended finger to move, right-click to rotate camera';
    document.getElementById('game-container').appendChild(instruction);
    
    // Show second instruction after a delay
    setTimeout(() => {
        try {
            document.getElementById('game-container').removeChild(instruction);
            
            // Add second instruction about keyboard controls
            const instruction2 = document.createElement('div');
            instruction2.className = 'instruction';
            instruction2.textContent = 'Press arrow keys or WASD to move, C to toggle camera, R to reset view';
            document.getElementById('game-container').appendChild(instruction2);
            
            // Remove second instruction after animation
            setTimeout(() => {
                try {
                    document.getElementById('game-container').removeChild(instruction2);
                } catch (e) {
                    console.log('Instruction element already removed');
                }
            }, 5000);
        } catch (e) {
            console.log('Instruction element already removed');
        }
    }, 5000);
}

/**
 * Restart the game after game over
 */
function restartGame() {
    console.log('Restarting game');
    
    // Hide game over overlay
    gameoverOverlay.classList.add('hidden');
    
    // Reset game state
    gameState.isPlaying = true;
    gameState.isGameOver = false;
    gameState.score = GAME_CONFIG.initialScore;
    gameState.lives = GAME_CONFIG.initialLives;
    gameState.level = 1;
    gameState.visitedTiles = new Set();
    gameState.playerPosition = { x: 0, y: 0 };
    gameState.projectiles = [];
    gameState.enemies = [];
    
    // Update displays
    updateScoreDisplay();
    updateLivesDisplay();
    updateLevelDisplay();
    
    // Generate new level
    generateLevel();
    
    // Resume game loop
    animate();
}

/**
 * Handle game over
 */
function gameOver() {
    gameState.isGameOver = true;
    gameState.isPlaying = false;
    
    // Update final score displays
    finalScoreDisplay.textContent = gameState.score;
    finalLevelDisplay.textContent = gameState.level;
    
    // Show game over overlay
    gameoverOverlay.classList.remove('hidden');
}

/**
 * Game animation loop
 */
function animate() {
    if (!gameState.isGameOver) {
        requestAnimationFrame(animate);
    }
    
    // Update projectiles
    updateProjectiles();
    
    // Update enemies
    updateEnemies();
    
    // Update controls if enabled
    if (controls && controls.enabled) {
        controls.update();
    }
    
    // Render scene
    renderer.render(scene, camera);
}

/**
 * Update projectiles positions and check for collisions
 */
function updateProjectiles() {
    // Skip if paused or not active
    if (!gameState.isPlaying || gameState.isGameOver) return;
    
    // Update existing projectiles
    for (let i = gameState.projectiles.length - 1; i >= 0; i--) {
        const projectile = gameState.projectiles[i];
        
        // Update position
        projectile.mesh.position.x += projectile.velocity.x * GAME_CONFIG.projectileSpeed * (1 + 0.1 * gameState.level);
        projectile.mesh.position.z += projectile.velocity.z * GAME_CONFIG.projectileSpeed * (1 + 0.1 * gameState.level);
        
        // Check for collision with player
        const playerX = gameState.playerPosition.x;
        const playerY = gameState.playerPosition.y;
        
        // Convert mesh position to grid coordinates
        const gridX = Math.round(projectile.mesh.position.x);
        const gridY = Math.round(projectile.mesh.position.z);
        
        // Check collision with player
        if (gridX === playerX && gridY === playerY) {
            // Collision with player!
            handleCollision('projectile');
            
            // Remove projectile
            scene.remove(projectile.mesh);
            gameState.projectiles.splice(i, 1);
            continue;
        }
        
        // Check if projectile is out of bounds
        if (gridX < 0 || gridX >= GAME_CONFIG.gridSize || 
            gridY < 0 || gridY >= GAME_CONFIG.gridSize) {
            // Remove projectile
            scene.remove(projectile.mesh);
            gameState.projectiles.splice(i, 1);
        }
        
        // Check if projectile hit a wall
        if (gridX >= 0 && gridX < GAME_CONFIG.gridSize && 
            gridY >= 0 && gridY < GAME_CONFIG.gridSize) {
            if (gameState.grid[gridY][gridX] === 1) {
                // Remove projectile
                scene.remove(projectile.mesh);
                gameState.projectiles.splice(i, 1);
            }
        }
    }
    
    // Spawn new projectiles based on level
    if (Math.random() < 0.01 * gameState.level && gameState.projectiles.length < gameState.level + 2) {
        spawnProjectile();
    }
}

/**
 * Spawn a new projectile
 */
function spawnProjectile() {
    // Skip if paused or not active
    if (!gameState.isPlaying || gameState.isGameOver) return;
    
    // Choose random edge position
    let x, y, vx = 0, vy = 0;
    
    // Choose random side (0: top, 1: right, 2: bottom, 3: left)
    const side = Math.floor(Math.random() * 4);
    
    switch (side) {
        case 0: // Top
            x = Math.floor(Math.random() * GAME_CONFIG.gridSize);
            y = 0;
            vy = 1;
            break;
        case 1: // Right
            x = GAME_CONFIG.gridSize - 1;
            y = Math.floor(Math.random() * GAME_CONFIG.gridSize);
            vx = -1;
            break;
        case 2: // Bottom
            x = Math.floor(Math.random() * GAME_CONFIG.gridSize);
            y = GAME_CONFIG.gridSize - 1;
            vy = -1;
            break;
        case 3: // Left
            x = 0;
            y = Math.floor(Math.random() * GAME_CONFIG.gridSize);
            vx = 1;
            break;
    }
    
    // Create projectile
    const projectileGeometry = new THREE.SphereGeometry(0.2, 8, 8);
    const projectileMaterial = new THREE.MeshLambertMaterial({ color: 0xff0000 });
    const projectileMesh = new THREE.Mesh(projectileGeometry, projectileMaterial);
    
    // Position at edge of grid
    projectileMesh.position.set(
        x * GAME_CONFIG.tileSize, 
        0.5, 
        y * GAME_CONFIG.tileSize
    );
    
    // Add to scene
    scene.add(projectileMesh);
    
    // Add to projectiles list
    gameState.projectiles.push({
        mesh: projectileMesh,
        velocity: { x: vx, z: vy }
    });
}

/**
 * Update enemy positions and check for collisions
 */
function updateEnemies() {
    // Skip if paused or not active
    if (!gameState.isPlaying || gameState.isGameOver) return;
    
    // Update existing enemies
    for (let i = gameState.enemies.length - 1; i >= 0; i--) {
        const enemy = gameState.enemies[i];
        
        // Move towards player with simple AI
        const playerX = gameState.playerPosition.x;
        const playerY = gameState.playerPosition.y;
        
        // Convert mesh position to grid coordinates
        const currentX = Math.round(enemy.mesh.position.x);
        const currentY = Math.round(enemy.mesh.position.z);
        
        // Calculate direction to player (very simple AI)
        let dx = 0;
        let dy = 0;
        
        if (currentX < playerX) dx = 1;
        else if (currentX > playerX) dx = -1;
        
        if (currentY < playerY) dy = 1;
        else if (currentY > playerY) dy = -1;
        
        // Try horizontal movement first
        let nextX = currentX + dx;
        let nextY = currentY;
        
        // Check if next position is valid (not a wall)
        if (nextX >= 0 && nextX < GAME_CONFIG.gridSize && 
            nextY >= 0 && nextY < GAME_CONFIG.gridSize) {
            if (gameState.grid[nextY][nextX] !== 1) {
                enemy.mesh.position.x += dx * GAME_CONFIG.enemySpeed;
            } else {
                // Try vertical movement instead
                nextX = currentX;
                nextY = currentY + dy;
                
                if (nextY >= 0 && nextY < GAME_CONFIG.gridSize && 
                    nextX >= 0 && nextX < GAME_CONFIG.gridSize) {
                    if (gameState.grid[nextY][nextX] !== 1) {
                        enemy.mesh.position.z += dy * GAME_CONFIG.enemySpeed;
                    }
                }
            }
        }
        
        // Check for collision with player
        if (Math.abs(enemy.mesh.position.x - playerX) < 0.5 && 
            Math.abs(enemy.mesh.position.z - playerY) < 0.5) {
            // Collision with player!
            handleCollision('enemy');
            
            // Remove enemy
            scene.remove(enemy.mesh);
            gameState.enemies.splice(i, 1);
        }
    }
    
    // Spawn new enemies based on level
    if (Math.random() < 0.005 * gameState.level && gameState.enemies.length < Math.floor(gameState.level / 2)) {
        spawnEnemy();
    }
}

/**
 * Spawn a new enemy
 */
function spawnEnemy() {
    // Skip if paused or not active
    if (!gameState.isPlaying || gameState.isGameOver) return;
    
    // Choose random position away from player
    let x, y;
    const playerX = gameState.playerPosition.x;
    const playerY = gameState.playerPosition.y;
    
    do {
        x = Math.floor(Math.random() * GAME_CONFIG.gridSize);
        y = Math.floor(Math.random() * GAME_CONFIG.gridSize);
        
        // Ensure minimum distance from player
        const distance = Math.abs(x - playerX) + Math.abs(y - playerY);
        
        // Check if position is valid (not a wall and not too close to player)
        if (distance > 5 && gameState.grid[y][x] !== 1) {
            break;
        }
    } while (true);
    
    // Create enemy
    const enemyGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const enemyMaterial = new THREE.MeshLambertMaterial({ color: 0xff00ff });
    const enemyMesh = new THREE.Mesh(enemyGeometry, enemyMaterial);
    
    // Position
    enemyMesh.position.set(
        x * GAME_CONFIG.tileSize, 
        0.5, 
        y * GAME_CONFIG.tileSize
    );
    
    // Add to scene
    scene.add(enemyMesh);
    
    // Add to enemies list
    gameState.enemies.push({
        mesh: enemyMesh
    });
}

/**
 * Create 3D objects for the grid
 */
function createGridObjects() {
    const size = GAME_CONFIG.gridSize;
    
    // Create floor
    const floorGeometry = new THREE.PlaneGeometry(size, size);
    const floorMaterial = new THREE.MeshLambertMaterial({ 
        color: 0x444444,
        side: THREE.DoubleSide
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = Math.PI / 2;
    floor.position.set((size - 1) / 2, -0.01, (size - 1) / 2);
    gridGroup.add(floor);
    
    // Create grid lines
    const gridLinesMaterial = new THREE.LineBasicMaterial({ color: 0x333333 });
    
    // Horizontal lines
    for (let i = 0; i <= size; i++) {
        const lineGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, i),
            new THREE.Vector3(size, 0, i)
        ]);
        const line = new THREE.Line(lineGeometry, gridLinesMaterial);
        gridGroup.add(line);
    }
    
    // Vertical lines
    for (let i = 0; i <= size; i++) {
        const lineGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(i, 0, 0),
            new THREE.Vector3(i, 0, size)
        ]);
        const line = new THREE.Line(lineGeometry, gridLinesMaterial);
        gridGroup.add(line);
    }
    
    // Create wall cubes
    const wallGeometry = new THREE.BoxGeometry(1, 1, 1);
    const wallMaterial = new THREE.MeshLambertMaterial({ color: 0x0066cc });
    
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (gameState.grid[y][x] === 1) {
                const wall = new THREE.Mesh(wallGeometry, wallMaterial);
                wall.position.set(x, 0.5, y);
                gridGroup.add(wall);
            }
        }
    }
    
    // Create player cube
    const playerGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const playerMaterial = new THREE.MeshLambertMaterial({ color: 0x00ff00 });
    playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);
    playerMesh.position.set(
        gameState.playerPosition.x,
        0.5,
        gameState.playerPosition.y
    );
    gridGroup.add(playerMesh);
    
    // Create goal marker
    const goalGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 16);
    const goalMaterial = new THREE.MeshLambertMaterial({ color: 0xffcc00 });
    goalMesh = new THREE.Mesh(goalGeometry, goalMaterial);
    goalMesh.position.set(
        gameState.goalPosition.x,
        0.05,
        gameState.goalPosition.y
    );
    gridGroup.add(goalMesh);
}

// --- Camera Controls: Enable OrbitControls on right mouse or 'C' key ---
let isDraggingCamera = false;
canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) { // Right mouse button
        controls.enabled = true;
        isDraggingCamera = true;
    }
});
canvas.addEventListener('mouseup', (e) => {
    if (e.button === 2) {
        controls.enabled = false;
        isDraggingCamera = false;
    }
});
canvas.addEventListener('mouseleave', () => {
    if (isDraggingCamera) {
        controls.enabled = false;
        isDraggingCamera = false;
    }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // Disable context menu

document.addEventListener('keydown', (e) => {
    if (e.key === 'c' || e.key === 'C') {
        controls.enabled = !controls.enabled;
    }
});

/**
 * Set up camera controls for easy interaction
 */
function setupCameraControls() {
    // Allow mouse wheel to zoom
    controls.enableZoom = true;
    // Allow right-click drag to rotate
    controls.enableRotate = true;
    // Allow middle-click drag to pan
    controls.enablePan = true;
    // Make the controls feel smoother
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    
    // Default to disabled, will be enabled on right-click
    controls.enabled = false;
    
    // Set rotation limits
    controls.maxPolarAngle = Math.PI / 2; // Limit to 90 degrees to prevent going below the grid
    
    // Track if right mouse button is pressed for camera control
    let isRightMouseDown = false;
    
    // Add event listeners for mouse controls
    canvas.addEventListener('mousedown', (event) => {
        if (event.button === 2) { // Right mouse button
            isRightMouseDown = true;
            controls.enabled = true;
            
            // Change cursor to indicate camera movement mode
            canvas.style.cursor = 'move';
        }
    });
    
    canvas.addEventListener('mouseup', (event) => {
        if (event.button === 2) { // Right mouse button
            isRightMouseDown = false;
            controls.enabled = false;
            
            // Reset cursor
            canvas.style.cursor = 'default';
        }
    });
    
    canvas.addEventListener('mouseleave', () => {
        if (isRightMouseDown) {
            isRightMouseDown = false;
            controls.enabled = false;
            canvas.style.cursor = 'default';
        }
    });
    
    // Add scroll wheel support (always enabled regardless of right mouse button)
    canvas.addEventListener('wheel', () => {
        controls.enabled = true;
        setTimeout(() => {
            if (!isRightMouseDown) {
                controls.enabled = false;
            }
        }, 1000); // Re-disable controls after scrolling if right mouse isn't down
    });
    
    // Prevent context menu on right-click
    canvas.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });
    
    // Add keyboard shortcuts for camera control
    document.addEventListener('keydown', (event) => {
        if (event.key === 'c' || event.key === 'C') {
            // Toggle camera control mode
            controls.enabled = !controls.enabled;
            canvas.style.cursor = controls.enabled ? 'move' : 'default';
        }
        
        if (event.key === 'r' || event.key === 'R') {
            // Reset camera to default top-down position
            const gridCenterX = GAME_CONFIG.gridSize / 2 - 0.5;
            const gridCenterZ = GAME_CONFIG.gridSize / 2 - 0.5;
            camera.position.set(gridCenterX, 18, gridCenterZ);
            camera.lookAt(gridCenterX, 0, gridCenterZ);
            controls.update();
        }
    });
    
    // Update controls in animation loop
    const originalAnimate = animate;
    animate = function() {
        if (controls.enabled) {
            controls.update();
        }
        originalAnimate();
    };
}

/**
 * Handle keyboard input for camera control and movement
 * @param {KeyboardEvent} event - Keyboard event
 */
function handleKeyboardInput(event) {
    if (!event || event.defaultPrevented) {
        return; // Do nothing if the event was already processed
    }
    
    // Store the key pressed
    const key = event.key;
    
    // Debug log key press when game is initializing to help troubleshoot
    if (!gameState.isPlaying && !gameState.isGameOver) {
        console.log('Keyboard input during initialization:', key);
    }
    
    // Allow certain keys even when not playing
    switch (key) {
        case 'Escape':
            // Emergency exit from loading screen if game is stuck
            console.log('Emergency escape from loading screen');
            loadingOverlay.classList.add('hidden');
            startOverlay.classList.remove('hidden');
            webcamStatus.textContent = 'Manual override. Using keyboard controls.';
            break;
            
        case 'd':
        case 'D':
            // Toggle debug mode
            gameState.debugMode = !gameState.debugMode;
                                             console.log('Debug mode:', gameState.debugMode ? 'enabled' : 'disabled');
            break;
            
        case 'F5':
            // Allow refresh
            return;
    }
    
    // Rest of controls only work when game is active
    if (!gameState.isPlaying) return;
    
    switch (key) {
        // Camera controls
        case 'c':
            // Toggle camera control
            controls.enabled = !controls.enabled;
            console.log('Camera controls:', controls.enabled ? 'enabled' : 'disabled');
            break;
            
        case 'r':
            // Reset camera position
            camera.position.set(GAME_CONFIG.gridSize / 2 - 0.5, 12, GAME_CONFIG.gridSize / 2 + 6);
            camera.lookAt(GAME_CONFIG.gridSize / 2 - 0.5, 0, GAME_CONFIG.gridSize / 2 - 0.5);
            break;
            
        // Movement controls - Arrow Keys
        case 'ArrowUp':
            if (!gameState.isGameOver) {
                               handleMovement('up');
                event.preventDefault();
            }
            break;
            
        case 'ArrowDown':
            if (!gameState.isGameOver) {
                handleMovement('down');
                event.preventDefault();
            }
            break;
            
        case 'ArrowLeft':
            if (!gameState.isGameOver) {
                handleMovement('left');
                event.preventDefault();
            }
            break;
            
        case 'ArrowRight':
            if (!gameState.isGameOver) {
                handleMovement('right');
                event.preventDefault();
            }
            break;
            
        // Movement controls - WASD
        case 'w':
        case 'W':
            if (!gameState.isGameOver) {
                handleMovement('up');
                event.preventDefault();
            }
            break;
            
        case 's':
        case 'S':
            if (!gameState.isGameOver) {
                handleMovement('down');
                event.preventDefault();
            }
            break;
            
        case 'a':
        case 'A':
            if (!gameState.isGameOver) {
                handleMovement('left');
                event.preventDefault();
            }
            break;
            
        case 'd':
        case 'D':
            if (!gameState.isGameOver) {
                handleMovement('right');
                event.preventDefault();
            }
            break;
    }
}

// Finger connection pairs for drawing hand skeleton
const fingerConnections = [
    // Thumb
    [0, 1], [1, 2], [2, 3], [3, 4],
    // Index finger
    [0, 5], [5, 6], [6, 7], [7, 8],
    // Middle finger
    [0, 9], [9, 10], [10, 11], [11, 12],
    // Ring finger
    [0, 13], [13, 14], [14, 15], [15, 16],
    // Pinky
    [0, 17], [17, 18], [18, 19], [19, 20],
    // Palm
    [0, 5], [5, 9], [9, 13], [13, 17]
];

/**
 * Initialize hand overlay canvas for visualization
 */
function initHandOverlay() {
    try {
        // Simple initialization - just get the canvas and set default size
        handOverlayCanvas = document.getElementById('hand-overlay');
        if (!handOverlayCanvas) {
            console.log('Hand overlay canvas element not found');
            return;
        }
        
        handOverlayCtx = handOverlayCanvas.getContext('2d');
        if (!handOverlayCtx) {
            console.log('Could not get 2D context for hand overlay canvas');
            return;
        }
        
        // Set a fixed default size
        handOverlayCanvas.width = 240;
        handOverlayCanvas.height = 180;
        
        console.log('Hand overlay initialized with default size');
    } catch (error) {
        console.error('Error initializing hand overlay:', error);
    }
}

/**
 * Draw hand skeleton on overlay canvas
 * @param {Array} landmarks - Hand landmarks from TensorFlow.js handpose model
 * @param {boolean} isHandOpen - Whether the hand is detected as open
 */
function drawHandSkeleton(landmarks, isHandOpen) {
    if (!handOverlayCtx || !handOverlayCanvas) return;
    
    // Clear previous drawing
    try {
        handOverlayCtx.clearRect(0, 0, handOverlayCanvas.width, handOverlayCanvas.height);
    } catch (e) {
        console.error("Error clearing canvas:", e);
        return;
    }
    
    if (!landmarks || !landmarks.length) return;
    
    // Set line style
    handOverlayCtx.lineWidth = 3;
    handOverlayCtx.strokeStyle = isHandOpen ? '#00ff00' : '#ff0000';
    handOverlayCtx.fillStyle = '#ffffff';
    
    // Scale factors to match video element size
    let scaleX = 1;
    let scaleY = 1;
    
    if (video && video.videoWidth) {
        scaleX = handOverlayCanvas.width / video.videoWidth;
        scaleY = handOverlayCanvas.height / video.videoHeight;
    }
    
    // Draw connections between landmarks (fingers and palm)
    handOverlayCtx.beginPath();
    for (const [i, j] of fingerConnections) {
        const start = landmarks[i];
        const end = landmarks[j];
        
        if (start && end) {
            handOverlayCtx.moveTo(start[0] * scaleX, start[1] * scaleY);
            handOverlayCtx.lineTo(end[0] * scaleX, end[1] * scaleY);
        }
    }
    handOverlayCtx.stroke();
    
    // Draw landmark points
    landmarks.forEach(point => {
        handOverlayCtx.beginPath();
        handOverlayCtx.arc(point[0] * scaleX, point[1] * scaleY, 4, 0, 2 * Math.PI);
        handOverlayCtx.fill();
    });
    
    // Highlight index finger tip with a different color when hand is open
    if (isHandOpen) {
        const indexTip = landmarks[8]; // Index fingertip is the 8th landmark
        if (indexTip) {
            handOverlayCtx.fillStyle = '#00ffff';
            handOverlayCtx.beginPath();
            handOverlayCtx.arc(indexTip[0] * scaleX, indexTip[1] * scaleY, 6, 0, 2 * Math.PI);
            handOverlayCtx.fill();
        }
    }
}

/**
 * Start the game initialization when the page is loaded
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM fully loaded, starting game initialization');
    
    // Small delay to ensure DOM is fully ready
    setTimeout(() => {
        try {
            initGame();
        } catch (error) {
            console.error('Error during game initialization:', error);
            
            // Force game to start even if there's an error
            loadingOverlay.classList.add('hidden');
            startOverlay.classList.remove('hidden');
            webcamStatus.textContent = 'Error during initialization. Using keyboard controls only.';
        }
    }, 500);
});

// Additional escape hatch for initialization
// This checks periodically if the page is stuck on loading and forces it to continue
(function setupEscapeHatch() {
    let initAttempts = 0;
    const maxAttempts = 5;
    
    function checkIfStuck() {
        initAttempts++;
        console.log(`Checking if initialization is stuck (attempt ${initAttempts}/${maxAttempts})`);
        
        // If the loading overlay is still visible after a few seconds, force start
        if (!loadingOverlay.classList.contains('hidden') && initAttempts >= maxAttempts) {
            console.log('Initialization appears to be stuck, forcing game to start');
            loadingOverlay.classList.add('hidden');
            startOverlay.classList.remove('hidden');
            webcamStatus.textContent = 'Game started in fallback mode. Using keyboard controls.';
        } else if (!loadingOverlay.classList.contains('hidden') && initAttempts < maxAttempts) {
            // Check again in a moment if we haven't reached max attempts
            setTimeout(checkIfStuck, 1000);
        }
    }
    
    // Start checking after a few seconds
    setTimeout(checkIfStuck, 3000);
})();