# GridRush - 3D Browser Game

A 3D browser-based game built with Three.js and TensorFlow.js that features hand gesture controls via webcam.

## Game Features

- **3D Grid**: Navigate through a randomly generated 10x10 grid with walls and obstacles
- **Hand Gesture Controls**: Control the game using your index finger position relative to your wrist
- **Increasing Difficulty**: Each level adds new challenges (no revisiting tiles, faster projectiles, enemies)
- **Scoring System**: Earn points by reaching the goal in fewer steps, lose points for deaths

## How to Play

1. Grant webcam access when prompted
2. Use hand gestures to control movement:
   - Point your index finger up to move up
   - Point your index finger down to move down
   - Point your index finger left to move left
   - Point your index finger right to move right
3. Navigate to the green goal while avoiding:
   - Blue walls
   - Yellow projectiles
   - Red enemy cones (on higher levels)
4. Complete levels to increase your score and challenge
5. (Optional) Press 'c' to toggle camera rotation, 'r' to reset camera view

## Technical Details

- **HTML5 & CSS3**: Core web technologies
- **JavaScript**: Game logic and interactions
- **Three.js**: 3D rendering and scene management
- **TensorFlow.js**: Hand pose detection and gesture recognition

## Setup Instructions

### Prerequisites

- Modern web browser (Chrome/Firefox recommended)
- Webcam
- Local web server for development

### Running Locally

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/GridRush.git
   cd GridRush
   ```

2. Install a local web server if you don't have one:
   ```
   npm install -g http-server
   ```

3. Start the server:
   ```
   http-server
   ```

4. Open your browser and navigate to `http://localhost:8080`

### Troubleshooting

- **Webcam not working**: Ensure you've granted camera permissions to your browser
- **Performance issues**: Close other intensive applications, reduce browser tabs
- **Hand detection problems**: Ensure good lighting and position your hand clearly in front of the camera

## Credits

- Three.js: https://threejs.org/
- TensorFlow.js: https://www.tensorflow.org/js
- Handpose model: https://github.com/tensorflow/tfjs-models/tree/master/handpose

## License

MIT License
