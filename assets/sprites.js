// build_sprites.py 가 생성한 파일. 직접 수정하지 말 것.
window.SPRITE_MANIFEST = {
  "player": {
    "frameWidth": 256,
    "frameHeight": 256,
    "anchorX": 128.0,
    "anims": {
      "idle": {
        "file": "player_idle.png",
        "frames": 8
      },
      "walk": {
        "file": "player_walk.png",
        "frames": 8
      },
      "attack": {
        "file": "player_attack.png",
        "frames": 8
      },
      "hit": {
        "file": "player_hit.png",
        "frames": 8
      }
    }
  },
  "enemies": {
    "1": {
      "frameWidth": 216,
      "frameHeight": 256,
      "anchorX": 108.0,
      "anims": {
        "move": {
          "file": "enemy_1_move.png",
          "frames": 8
        }
      }
    },
    "2": {
      "frameWidth": 130,
      "frameHeight": 256,
      "anchorX": 65.0,
      "anims": {
        "move": {
          "file": "enemy_2_move.png",
          "frames": 8
        }
      }
    },
    "3": {
      "frameWidth": 134,
      "frameHeight": 256,
      "anchorX": 67.0,
      "anims": {
        "move": {
          "file": "enemy_3_move.png",
          "frames": 8
        }
      }
    },
    "4": {
      "frameWidth": 247,
      "frameHeight": 256,
      "anchorX": 124.0,
      "anims": {
        "move": {
          "file": "enemy_4_move.png",
          "frames": 8
        }
      }
    },
    "5": {
      "frameWidth": 149,
      "frameHeight": 256,
      "anchorX": 74.0,
      "anims": {
        "move": {
          "file": "enemy_5_move.png",
          "frames": 8
        }
      }
    },
    "6": {
      "frameWidth": 219,
      "frameHeight": 256,
      "anchorX": 110.0,
      "anims": {
        "move": {
          "file": "enemy_6_move.png",
          "frames": 8
        }
      }
    }
  },
  "background": "game_bg.png",
  "player2": {
    "frameWidth": 256,
    "frameHeight": 256,
    "anchorX": 128.0,
    "anims": {
      "idle": {
        "file": "player2_idle.png",
        "frames": 8
      },
      "walk": {
        "file": "player2_walk.png",
        "frames": 8
      },
      "attack": {
        "file": "player2_attack.png",
        "frames": 8
      },
      "hit": {
        "file": "player2_hit.png",
        "frames": 8
      }
    }
  },
  "backgroundSize": [
    512,
    384
  ],
  "icons": {
    "heartIcon": {
      "file": "heartIcon.png",
      "width": 182,
      "height": 128
    },
    "coin": {
      "file": "coin.png",
      "width": 194,
      "height": 128
    },
    "healItem": {
      "file": "healItem.png",
      "width": 173,
      "height": 128
    }
  },
  "font": {
    "file": "font.png",
    "refHeight": 64,
    "glyphs": {
      "A": {
        "x": 0,
        "width": 64,
        "height": 62
      },
      "B": {
        "x": 66,
        "width": 57,
        "height": 62
      },
      "C": {
        "x": 125,
        "width": 58,
        "height": 62
      },
      "D": {
        "x": 185,
        "width": 60,
        "height": 62
      },
      "E": {
        "x": 247,
        "width": 56,
        "height": 62
      },
      "F": {
        "x": 305,
        "width": 59,
        "height": 62
      },
      "G": {
        "x": 366,
        "width": 61,
        "height": 61
      },
      "H": {
        "x": 429,
        "width": 60,
        "height": 61
      },
      "I": {
        "x": 491,
        "width": 43,
        "height": 61
      },
      "J": {
        "x": 536,
        "width": 60,
        "height": 61
      },
      "K": {
        "x": 598,
        "width": 63,
        "height": 61
      },
      "L": {
        "x": 663,
        "width": 58,
        "height": 61
      },
      "M": {
        "x": 723,
        "width": 64,
        "height": 62
      },
      "N": {
        "x": 789,
        "width": 60,
        "height": 62
      },
      "O": {
        "x": 851,
        "width": 59,
        "height": 62
      },
      "P": {
        "x": 912,
        "width": 58,
        "height": 62
      },
      "Q": {
        "x": 972,
        "width": 64,
        "height": 64
      },
      "R": {
        "x": 1038,
        "width": 60,
        "height": 62
      },
      "S": {
        "x": 1100,
        "width": 57,
        "height": 61
      },
      "T": {
        "x": 1159,
        "width": 59,
        "height": 61
      },
      "U": {
        "x": 1220,
        "width": 59,
        "height": 61
      },
      "V": {
        "x": 1281,
        "width": 61,
        "height": 61
      },
      "W": {
        "x": 1344,
        "width": 68,
        "height": 61
      },
      "X": {
        "x": 1414,
        "width": 60,
        "height": 61
      },
      "Y": {
        "x": 1476,
        "width": 62,
        "height": 62
      },
      "Z": {
        "x": 1540,
        "width": 59,
        "height": 62
      },
      "0": {
        "x": 1601,
        "width": 58,
        "height": 62
      },
      "1": {
        "x": 1661,
        "width": 46,
        "height": 62
      },
      "2": {
        "x": 1709,
        "width": 57,
        "height": 62
      },
      "3": {
        "x": 1768,
        "width": 59,
        "height": 62
      },
      "4": {
        "x": 1829,
        "width": 63,
        "height": 60
      },
      "5": {
        "x": 1894,
        "width": 59,
        "height": 60
      },
      "6": {
        "x": 1955,
        "width": 58,
        "height": 60
      },
      "7": {
        "x": 2015,
        "width": 60,
        "height": 60
      },
      "8": {
        "x": 2077,
        "width": 61,
        "height": 60
      },
      "9": {
        "x": 2140,
        "width": 59,
        "height": 60
      }
    }
  },
  "audio": {
    "sfx": {
      "attack": "sfx/attack.mp3",
      "button": "sfx/button.mp3",
      "coin": "sfx/coin.mp3",
      "countdown": "sfx/countdown.mp3",
      "enemyDie": "sfx/enemy_die.mp3",
      "heal": "sfx/heal.mp3",
      "hit": "sfx/hit.mp3"
    },
    "bgm": {
      "countdown": "bgm/countdown.mp3",
      "game": "bgm/game.mp3",
      "gameover": "bgm/gameover.mp3",
      "lobby": "bgm/lobby.mp3",
      "ranking": "bgm/ranking.mp3"
    }
  }
};
