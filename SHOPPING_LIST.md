# Shopping List

Current inventory: **4 × ESP32 (original ESP32-D0WD-V3), 4 USB cables**: 1 transmitter + 3 receivers, all running from the PC. The two "extra ESP32 boards" below are bought.

## For better range (recommended)

| Item | Qty | Why | Notes |
|---|---|---|---|
| USB power bank, or a 2–3 m USB extension cable | 1 | Lets the transmitter stand 2–4 m from the receiver instead of on the same desk. A longer link covers more of the room. | Any phone power bank works. |

## For direction and position of movement

One TX and one RX can only tell *whether* something moves, not *where* or *which way*. Direction needs several links crossing the room, so the program can compare which link is disturbed and how that changes over time.

| Item | Qty | Why | Notes |
|---|---|---|---|
| ESP32 dev board (original ESP32, same as the current ones) | 2 | Extra receivers: 1 TX + 3 RX gives 3 links for coarse position and direction of movement. | About $5–8 each. Same chip (ESP32-D0WD / "ESP32-DevKitC" / "ESP32-WROOM-32") so the same firmware works. |
| USB data cable for those boards | 2 | Each receiver sends its data to the PC over USB. | Must be **data** cables. |
| Powered USB hub (4 ports) | 1 | Connects all receivers to the PC. | Only if the PC doesn't have enough free USB ports. |
| USB extension cables (2–3 m) | 2–3 | Receivers need to stand in different corners of the room while still reaching the PC. | |

## Nice to have

| Item | Qty | Why |
|---|---|---|
| Tape measure | 1 | Records the board positions and distances for the report. |
| 60 GHz mmWave breathing/heart-rate radar (e.g. Seeed MR60BHA2) | 1 | Only if heart rate is required: ESP32 Wi-Fi cannot measure it. Also a reference to check the Wi-Fi breathing rate against. |

## Buying tips

- Match the connector to the board's port (micro-USB or USB-C). Check before buying.
- The product listing should say **"data"** or **"data sync"**. If it only says "charging cable", it may be charge-only.
