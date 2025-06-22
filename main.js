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
    debounceTime: 200,        // Milliseconds for gesture debounce
    wallPercentage: 0.2,      // Percentage of grid to fill with walls
    handDetectionInterval: 100 // Milliseconds between hand detection checks
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
    handDetected: false       // Flag for hand detection status
};

// Three.js variables
let scene, camera, renderer, controls;
let gridGroup, playerMesh, goalMesh;

// TensorFlow.js and Handpose variables
let handposeModel;
let video;
let lastGesture = null;
let isHandposeModelLoaded = false;

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
    try {
        loadingStatus.textContent = 'Setting up 3D environment...';
        setupThreeJS();
        
        loadingStatus.textContent = 'Loading hand detection model...';
        await setupHandpose();
        
        loadingStatus.textContent = 'Ready to play!';
        // Hide loading overlay, show start overlay
        loadingOverlay.classList.add('hidden');
        startOverlay.classList.remove('hidden');
        
        // Add event listeners
        startButton.addEventListener('click', startGame);
        restartButton.addEventListener('click', restartGame);
        
        // Optional feature: Add event listener for camera rotation with keyboard
        document.addEventListener('keydown', handleKeyboardInput);
    } catch (error) {
        console.error('Error initializing game:', error);
        loadingStatus.textContent = 'Error loading game. Please try refreshing.';
    }
}

/**
 * Set up Three.js environment
 */
function setupThreeJS() {
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222233);
    
    // Create camera (positioned above the grid looking down)
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(GAME_CONFIG.gridSize / 2 - 0.5, 12, GAME_CONFIG.gridSize / 2 + 6);
    camera.lookAt(GAME_CONFIG.gridSize / 2 - 0.5, 0, GAME_CONFIG.gridSize / 2 - 0.5);
    
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
    
    // Optional: Add orbit controls for camera rotation
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.rotateSpeed = 0.5;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI / 6; // Restrict vertical rotation
    controls.maxPolarAngle = Math.PI / 2.5;
    controls.enabled = false; // Disabled by default
    
    // Handle window resize
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

/**
 * Set up Handpose model and webcam
 */
async function setupHandpose() {
    try {
        video = document.getElementById('webcam');
        
        // Access webcam
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: 640,
                height: 480,
                facingMode: 'user'
            }
        });
        
        video.srcObject = stream;
        
        // Wait for video to be loaded
        return new Promise((resolve) => {
            video.onloadedmetadata = async () => {
                video.play();
                webcamStatus.textContent = 'Loading hand detection model...';
                
                // Load Handpose model
                handposeModel = await handpose.load();
                isHandposeModelLoaded = true;
                webcamStatus.textContent = 'Webcam ready! Point your hand at the camera.';
                
                // Start hand detection
                detectHands();
                resolve();
            };
        });
    } catch (error) {
        console.error('Error setting up webcam or Handpose:', error);
        webcamStatus.textContent = 'Error accessing webcam. Please check permissions.';
        throw error;
    }
}

/**
 * Start the hand detection loop
 */
async function detectHands() {
    if (!isHandposeModelLoaded || !gameState.isPlaying) return;
    
    try {
        const hands = await handposeModel.estimateHands(video);
        
        if (hands.length > 0) {
            gameState.handDetected = true;
            const hand = hands[0]; // Get the first detected hand
            
            // Get index finger and wrist landmarks
            const indexFinger = hand.annotations.indexFinger[3];
            const wrist = hand.landmarks[0];
            
            // Calculate direction vector from wrist to index finger
            const directionX = indexFinger[0] - wrist[0];
            const directionY = indexFinger[1] - wrist[1];
            
            // Determine gesture based on direction
            let gesture;
            if (Math.abs(directionX) > Math.abs(directionY)) {
                // Horizontal movement is stronger
                gesture = directionX > 0 ? 'right' : 'left';
            } else {
                // Vertical movement is stronger
                gesture = directionY > 0 ? 'down' : 'up'; // Y is inverted in the video
            }
            
            // Update movement if gesture changed and debounce time passed
            const currentTime = Date.now();
            if (gesture !== lastGesture && currentTime - gameState.lastMoveTime > GAME_CONFIG.debounceTime) {
                handleMovement(gesture);
                lastGesture = gesture;
                gameState.lastMoveTime = currentTime;
            }
        } else {
            gameState.handDetected = false;
        }
    } catch (error) {
        console.error('Error in hand detection:', error);
    }
    
    // Continue detection loop
    setTimeout(detectHands, GAME_CONFIG.handDetectionInterval);
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
 * Uses a simplified maze generation algorithm
 */
function generateGrid() {
    const size = GAME_CONFIG.gridSize;
    
    // Initialize grid with all walls (1)
    for (let y = 0; y < size; y++) {
        const row = [];
        for (let x = 0; x < size; x++) {
            row.push(1); // 1 represents a wall
        }
        gameState.grid.push(row);
    }
    
    // Create a path from start to goal
    // Using randomized DFS maze generation algorithm
    const startX = 0;
    const startY = 0;
    
    // Set goal position based on level
    // First level has a fixed goal for simplicity
    if (gameState.level === 1) {
        gameState.goalPosition = { x: 4, y: 4 };
    } else {
        // Random position in the far half of the grid
        gameState.goalPosition = {
            x: Math.floor(Math.random() * 3) + (size - 4),
            y: Math.floor(Math.random() * 3) + (size - 4)
        };
    }
    
    // Carve the path from start to end
    carvePath(startX, startY, gameState.goalPosition.x, gameState.goalPosition.y);
    
    // Add some random open spaces to make it more interesting
    addRandomOpenings();
    
    // Always ensure start and goal positions are open
    gameState.grid[startY][startX] = 0; // Start position
    gameState.grid[gameState.goalPosition.y][gameState.goalPosition.x] = 0; // Goal position
}

/**
 * Carve a path from start to end position
 * @param {number} startX - Starting X coordinate
 * @param {number} startY - Starting Y coordinate
 * @param {number} endX - Ending X coordinate
 * @param {number} endY - Ending Y coordinate
 */
function carvePath(startX, startY, endX, endY) {
    const size = GAME_CONFIG.gridSize;
    
    // Mark all cells as unvisited
    const visited = Array(size).fill().map(() => Array(size).fill(false));
    
    // Use A* pathfinding to find a path
    const openSet = [{ x: startX, y: startY, g: 0, h: 0, f: 0, parent: null }];
    
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
            let temp = current;
            while (temp.parent) {
                // Set path tiles to open (0)
                gameState.grid[temp.y][temp.x] = 0;
                temp = temp.parent;
            }
            gameState.grid[startY][startX] = 0;
            return true;
        }
        
        // Remove current from openSet and add to closedSet
        openSet.splice(lowestIndex, 1);
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
            
            // Skip if visited
            if (visited[neighborY][neighborX]) {
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
    
    // No path found, so just clear a direct path
    const dx = endX > startX ? 1 : -1;
    const dy = endY > startY ? 1 : -1;
    
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
    
    // Ensure end position is clear
    gameState.grid[endY][endX] = 0;
    
    return false;
}

/**
 * Add random openings to the grid
 */
function addRandomOpenings() {
    const size = GAME_CONFIG.gridSize;
    const numOpenings = Math.floor(size * size * GAME_CONFIG.wallPercentage * 0.5);
    
    for (let i = 0; i < numOpenings; i++) {
        const x = Math.floor(Math.random() * size);
        const y = Math.floor(Math.random() * size);
        
        // Don't open start or goal positions
        if ((x === 0 && y === 0) || 
            (x === gameState.goalPosition.x && y === gameState.goalPosition.y)) {
            continue;
        }
        
        gameState.grid[y][x] = 0;
    }
}

/**
 * Create 3D objects for the grid
 */
function createGridObjects() {
    const size = GAME_CONFIG.gridSize;
    const tileSize = GAME_CONFIG.tileSize;
    
    // Create floor
    const floorGeometry = new THREE.PlaneGeometry(size * tileSize, size * tileSize);
    const floorMaterial = new THREE.MeshStandardMaterial({
        color: 0x444444,
        roughness: 0.8
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((size - 1) * tileSize / 2, -0.05, (size - 1) * tileSize / 2);
    floor.receiveShadow = true;
    gridGroup.add(floor);
    
    // Create grid lines
    const gridHelper = new THREE.GridHelper(size * tileSize, size, 0x000000, 0x222222);
    gridHelper.position.set((size - 1) * tileSize / 2, 0, (size - 1) * tileSize / 2);
    gridGroup.add(gridHelper);
    
    // Create walls and tiles
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            // Create tile
            const tileGeometry = new THREE.BoxGeometry(tileSize * 0.95, 0.1, tileSize * 0.95);
            let tileMaterial;
            
            // Different colors based on tile type
            if (x === 0 && y === 0) {
                // Start position - blue
                tileMaterial = new THREE.MeshStandardMaterial({ color: 0x3333ff });
            } else if (x === gameState.goalPosition.x && y === gameState.goalPosition.y) {
                // Goal position - green
                tileMaterial = new THREE.MeshStandardMaterial({ color: 0x33ff33 });
            } else {
                // Regular tile - gray with some variation
                const grayValue = 0.5 + Math.random() * 0.2;
                tileMaterial = new THREE.MeshStandardMaterial({ 
                    color: new THREE.Color(grayValue, grayValue, grayValue) 
                });
            }
            
            const tile = new THREE.Mesh(tileGeometry, tileMaterial);
            tile.position.set(x * tileSize, 0, y * tileSize);
            tile.receiveShadow = true;
            gridGroup.add(tile);
            
            // Create walls
            if (gameState.grid[y][x] === 1) {
                const wallGeometry = new THREE.BoxGeometry(tileSize * 0.95, tileSize, tileSize * 0.95);
                const wallMaterial = new THREE.MeshStandardMaterial({
                    color: 0x2222cc,
                    roughness: 0.7
                });
                const wall = new THREE.Mesh(wallGeometry, wallMaterial);
                wall.position.set(x * tileSize, tileSize / 2, y * tileSize);
                wall.castShadow = true;
                wall.receiveShadow = true;
                gridGroup.add(wall);
            }
        }
    }
    
    // Create player (red cube)
    const playerGeometry = new THREE.BoxGeometry(tileSize * 0.5, tileSize * 0.5, tileSize * 0.5);
    const playerMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);
    playerMesh.position.set(0, 0.5, 0);
    playerMesh.castShadow = true;
    gridGroup.add(playerMesh);
    
    // Create goal marker (green sphere)
    const goalGeometry = new THREE.SphereGeometry(tileSize * 0.3, 16, 16);
    const goalMaterial = new THREE.MeshStandardMaterial({
        color: 0x00ff00,
        emissive: 0x00ff00,
        emissiveIntensity: 0.5
    });
    goalMesh = new THREE.Mesh(goalGeometry, goalMaterial);
    goalMesh.position.set(
        gameState.goalPosition.x * tileSize,
        0.5,
        gameState.goalPosition.y * tileSize
    );
    gridGroup.add(goalMesh);
    
    // Add a pulsing animation to the goal
    animateGoal();
}

/**
 * Animate the goal marker with a pulsing effect
 */
function animateGoal() {
    if (!goalMesh) return;
    
    const scaleFactor = 1 + 0.2 * Math.sin(Date.now() * 0.003);
    goalMesh.scale.set(scaleFactor, scaleFactor, scaleFactor);
    
    // Update goal animation in the next frame
    if (gameState.isPlaying && !gameState.isGameOver) {
        requestAnimationFrame(animateGoal);
    }
}

/**
 * Spawn a projectile from a random edge of the grid
 */
function spawnProjectile() {
    if (gameState.isGameOver || !gameState.isPlaying) return;
    
    const size = GAME_CONFIG.gridSize;
    
    // Decide which edge to spawn from (0 = top, 1 = right, 2 = bottom, 3 = left)
    const edge = Math.floor(Math.random() * 4);
    let position, direction;
    
    switch (edge) {
        case 0: // Top edge
            position = {
                x: Math.floor(Math.random() * size),
                y: -1
            };
            direction = { x: 0, y: 1 };
            break;
        case 1: // Right edge
            position = {
                x: size,
                y: Math.floor(Math.random() * size)
            };
            direction = { x: -1, y: 0 };
            break;
        case 2: // Bottom edge
            position = {
                x: Math.floor(Math.random() * size),
                y: size
            };
            direction = { x: 0, y: -1 };
            break;
        case 3: // Left edge
            position = {
                x: -1,
                y: Math.floor(Math.random() * size)
            };
            direction = { x: 1, y: 0 };
            break;
    }
    
    // Create projectile 3D object
    const projectileGeometry = new THREE.SphereGeometry(0.2, 8, 8);
    const projectileMaterial = new THREE.MeshStandardMaterial({
        color: 0xffcc00,
        emissive: 0xffcc00,
        emissiveIntensity: 0.5
    });
    
    const projectileMesh = new THREE.Mesh(projectileGeometry, projectileMaterial);
    projectileMesh.position.set(
        position.x * GAME_CONFIG.tileSize,
        0.5,
        position.y * GAME_CONFIG.tileSize
    );
    projectileMesh.castShadow = true;
    
    // Add projectile to scene and game state
    gridGroup.add(projectileMesh);
    
    // Current level increases speed
    const speed = GAME_CONFIG.projectileSpeed * (1 + (gameState.level - 1) * 0.2);
    
    gameState.projectiles.push({
        mesh: projectileMesh,
        position: position,
        direction: direction,
        speed: speed
    });
}

/**
 * Spawn an enemy at a random position
 */
function spawnEnemy() {
    if (gameState.isGameOver || !gameState.isPlaying || gameState.level < 5) return;
    
    const size = GAME_CONFIG.gridSize;
    let x, y;
    
    // Try to find an open position that's not too close to the player
    // and not the goal position
    do {
        x = Math.floor(Math.random() * size);
        y = Math.floor(Math.random() * size);
        
        // Calculate distance from player
        const distanceFromPlayer = Math.sqrt(
            Math.pow(x - gameState.playerPosition.x, 2) +
            Math.pow(y - gameState.playerPosition.y, 2)
        );
        
        // Check if position is valid
        if (gameState.grid[y][x] === 0 && 
            (x !== gameState.goalPosition.x || y !== gameState.goalPosition.y) &&
            distanceFromPlayer > 3) {
            break;
        }
    } while (true);
    
    // Create enemy 3D object
    const enemyGeometry = new THREE.ConeGeometry(0.3, 0.6, 4);
    const enemyMaterial = new THREE.MeshStandardMaterial({
        color: 0xff3333,
        emissive: 0xff0000,
        emissiveIntensity: 0.3
    });
    
    const enemyMesh = new THREE.Mesh(enemyGeometry, enemyMaterial);
    enemyMesh.position.set(
        x * GAME_CONFIG.tileSize,
        0.5,
        y * GAME_CONFIG.tileSize
    );
    enemyMesh.castShadow = true;
    
    // Add enemy to scene and game state
    gridGroup.add(enemyMesh);
    
    // Current level increases speed
    const speed = GAME_CONFIG.enemySpeed * (1 + (gameState.level - 5) * 0.2);
    
    gameState.enemies.push({
        mesh: enemyMesh,
        position: { x, y },
        lastMoveTime: Date.now(),
        speed: speed
    });
}

/**
 * Update projectile positions and check for collisions
 * @param {number} deltaTime - Time since last frame in milliseconds
 */
function updateProjectiles(deltaTime) {
    for (let i = gameState.projectiles.length - 1; i >= 0; i--) {
        const projectile = gameState.projectiles[i];
        
        // Update position
        projectile.position.x += projectile.direction.x * projectile.speed * deltaTime;
        projectile.position.y += projectile.direction.y * projectile.speed * deltaTime;
        
        // Update mesh position
        projectile.mesh.position.x = projectile.position.x * GAME_CONFIG.tileSize;
        projectile.mesh.position.z = projectile.position.y * GAME_CONFIG.tileSize;
        
        // Check if out of bounds
        if (projectile.position.x < -1 || 
            projectile.position.x > GAME_CONFIG.gridSize ||
            projectile.position.y < -1 || 
            projectile.position.y > GAME_CONFIG.gridSize) {
            // Remove projectile from scene and array
            gridGroup.remove(projectile.mesh);
            gameState.projectiles.splice(i, 1);
            continue;
        }
        
        // Check collision with player
        const distanceToPlayer = Math.sqrt(
            Math.pow(projectile.position.x - gameState.playerPosition.x, 2) +
            Math.pow(projectile.position.y - gameState.playerPosition.y, 2)
        );
        
        if (distanceToPlayer < 0.4) {
            handleCollision('projectile');
            
            // Remove projectile from scene and array
            gridGroup.remove(projectile.mesh);
            gameState.projectiles.splice(i, 1);
            continue;
        }
        
        // Check collision with walls
        const gridX = Math.floor(projectile.position.x);
        const gridY = Math.floor(projectile.position.y);
        
        if (gridX >= 0 && gridX < GAME_CONFIG.gridSize && 
            gridY >= 0 && gridY < GAME_CONFIG.gridSize) {
            if (gameState.grid[gridY][gridX] === 1) {
                // Remove projectile from scene and array
                gridGroup.remove(projectile.mesh);
                gameState.projectiles.splice(i, 1);
            }
        }
    }
}

/**
 * Update enemy positions and check for collisions
 * @param {number} deltaTime - Time since last frame in milliseconds
 */
function updateEnemies(deltaTime) {
    for (const enemy of gameState.enemies) {
        const currentTime = Date.now();
        const moveInterval = 1000 / enemy.speed;
        
        if (currentTime - enemy.lastMoveTime > moveInterval) {
            // Simple AI: Try to move toward player
            let dx = gameState.playerPosition.x - enemy.position.x;
            let dy = gameState.playerPosition.y - enemy.position.y;
            
            // Normalize to single-tile movements
            if (Math.abs(dx) > Math.abs(dy)) {
                dy = 0;
                dx = dx > 0 ? 1 : -1;
            } else {
                dx = 0;
                dy = dy > 0 ? 1 : -1;
            }
            
            const newX = enemy.position.x + dx;
            const newY = enemy.position.y + dy;
            
            // Check if can move to new position
            if (newX >= 0 && newX < GAME_CONFIG.gridSize && 
                newY >= 0 && newY < GAME_CONFIG.gridSize && 
                gameState.grid[newY][newX] !== 1) {
                enemy.position.x = newX;
                enemy.position.y = newY;
            } else {
                // Try random movement if blocked
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
                
                // Try each direction until valid move found
                for (const dir of directions) {
                    const tryX = enemy.position.x + dir.x;
                    const tryY = enemy.position.y + dir.y;
                    
                    if (tryX >= 0 && tryX < GAME_CONFIG.gridSize && 
                        tryY >= 0 && tryY < GAME_CONFIG.gridSize && 
                        gameState.grid[tryY][tryX] !== 1) {
                        enemy.position.x = tryX;
                        enemy.position.y = tryY;
                        break;
                    }
                }
            }
            
            // Update mesh position
            enemy.mesh.position.x = enemy.position.x * GAME_CONFIG.tileSize;
            enemy.mesh.position.z = enemy.position.y * GAME_CONFIG.tileSize;
            
            // Point enemy in movement direction
            if (dx !== 0 || dy !== 0) {
                enemy.mesh.lookAt(
                    (enemy.position.x + dx) * GAME_CONFIG.tileSize,
                    0.5,
                    (enemy.position.y + dy) * GAME_CONFIG.tileSize
                );
            }
            
            enemy.lastMoveTime = currentTime;
        }
        
        // Check collision with player
        if (enemy.position.x === gameState.playerPosition.x && 
            enemy.position.y === gameState.playerPosition.y) {
            handleCollision('enemy');
        }
    }
}

/**
 * Start the game
 */
function startGame() {
    // Hide start overlay
    startOverlay.classList.add('hidden');
    
    // Initialize game state
    gameState.score = GAME_CONFIG.initialScore;
    gameState.lives = GAME_CONFIG.initialLives;
    gameState.level = 1;
    gameState.isGameOver = false;
    gameState.isPlaying = true;
    gameState.visitedTiles = new Set();
    gameState.projectiles = [];
    gameState.enemies = [];
    
    // Update displays
    updateScoreDisplay();
    updateLivesDisplay();
    updateLevelDisplay();
    
    // Generate first level
    generateLevel();
    
    // Start animation loop
    lastFrameTime = Date.now();
    animate();
    
    // Start projectile spawning
    startProjectileSpawner();
    
    // Start enemy spawning for later levels
    startEnemySpawner();
    
    // Enable orbit controls
    controls.enabled = true;
}

/**
 * Restart the game
 */
function restartGame() {
    // Hide game over overlay
    gameoverOverlay.classList.add('hidden');
    
    // Start new game
    startGame();
}

/**
 * Game over
 */
function gameOver() {
    gameState.isGameOver = true;
    gameState.isPlaying = false;
    
    // Update final score display
    finalScoreDisplay.textContent = Math.max(0, gameState.score);
    finalLevelDisplay.textContent = gameState.level;
    
    // Show game over overlay after a short delay
    setTimeout(() => {
        gameoverOverlay.classList.remove('hidden');
    }, 1000);
}

/**
 * Start spawning projectiles
 */
function startProjectileSpawner() {
    if (gameState.isGameOver || !gameState.isPlaying) return;
    
    // Spawn a projectile
    spawnProjectile();
    
    // Schedule next spawn with level-based timing
    const interval = GAME_CONFIG.projectileInterval / (1 + (gameState.level - 1) * 0.1);
    setTimeout(startProjectileSpawner, interval);
}

/**
 * Start spawning enemies (for higher levels)
 */
function startEnemySpawner() {
    if (gameState.isGameOver || !gameState.isPlaying) return;
    
    // Only spawn enemies from level 5 onward
    if (gameState.level >= 5) {
        // Limit number of enemies based on level
        const maxEnemies = Math.min(3, gameState.level - 4);
        
        if (gameState.enemies.length < maxEnemies) {
            spawnEnemy();
        }
    }
    
    // Schedule next spawn check
    setTimeout(startEnemySpawner, 5000);
}

/**
 * Handle keyboard input for camera control
 * @param {KeyboardEvent} event - Keyboard event
 */
function handleKeyboardInput(event) {
    if (!gameState.isPlaying) return;
    
    switch (event.key) {
        case 'c':
            // Toggle camera control
            controls.enabled = !controls.enabled;
            break;
        case 'r':
            // Reset camera position
            camera.position.set(GAME_CONFIG.gridSize / 2 - 0.5, 12, GAME_CONFIG.gridSize / 2 + 6);
            camera.lookAt(GAME_CONFIG.gridSize / 2 - 0.5, 0, GAME_CONFIG.gridSize / 2 - 0.5);
            break;
        // Arrow key controls (for development/debugging)
        case 'ArrowUp':
            if (!gameState.isGameOver) {
                handleMovement('up');
            }
            break;
        case 'ArrowDown':
            if (!gameState.isGameOver) {
                handleMovement('down');
            }
            break;
        case 'ArrowLeft':
            if (!gameState.isGameOver) {
                handleMovement('left');
            }
            break;
        case 'ArrowRight':
            if (!gameState.isGameOver) {
                handleMovement('right');
            }
            break;
        default:
            break;
    }
}

// Variables for animation loop
let lastFrameTime = 0;

/**
 * Animation loop
 */
function animate() {
    if (!gameState.isPlaying) return;
    
    // Request next frame
    requestAnimationFrame(animate);
    
    // Calculate delta time
    const currentTime = Date.now();
    const deltaTime = (currentTime - lastFrameTime) / 1000; // Convert to seconds
    lastFrameTime = currentTime;
    
    // Update projectiles
    updateProjectiles(deltaTime * 60); // Normalize to 60fps rate
    
    // Update enemies
    updateEnemies(deltaTime * 60);
    
    // Update controls
    if (controls.enabled) {
        controls.update();
    }
    
    // Render scene
    renderer.render(scene, camera);
}

// Start the game
initGame();

// Add window resize event listener
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
