# Vision ZTA fleet inventory - 2026-07-18

Read-only inventory for the Vision Zero-Token Architecture. UNKNOWN means the probe did not produce local evidence; do not treat stale docs as live proof.

| Node | Role | Status | Hostname | OS | RAM | Disk | Vision ZTA lane |
|---|---|---|---|---|---|---|---|
| alpha | orchestrator | ok | Michaels-Mac-mini-2.local | macOS | 16.0 GiB | /dev/disk3s1s1   228Gi    17Gi    68Gi    20%    453k  712M    0%   / | orchestration, page splitting, hashing, deterministic preprocessing |
| bravo | compute | ok | FactoryLM-Bravo.local | macOS | 16.0 GiB | /dev/disk3s1s1   460Gi    11Gi   281Gi     4%    453k  2.9G    0%   / | interactive local VLM/OCR lane and independent verification |
| charlie | kb-host | ok | CharlieNodes-Mac-mini.local | macOS | 16.0 GiB | /dev/disk3s1s1   228Gi    11Gi    28Gi    30%    453k  290M    0%   / | document OCR/layout, embeddings/retrieval, batch corpus work |
| vps | production-ingress | ok | factorylm-prod | Ubuntu 24.04.3 LTS | 7.8 GiB | /dev/vda1       154G   97G   58G  63% / | authenticated ingress, job state, cache metadata; no heavy VLM |

## Details

### alpha
- cpu: Apple M4
- memory_free:

```text
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                9805.
Pages active:                            218985.
Pages inactive:                          215273.
Pages speculative:                         4951.
Pages throttled:                              0.
Pages wired down:                        242442.
Pages purgeable:                           2149.
```
- external_volumes: Macintosh HD
- docker: Docker version 29.2.1, build a5c7197d72
- docker_info:

```text
"" 0 0
Cannot connect to the Docker daemon at unix:///Users/factorylm/.docker/run/docker.sock. Is the docker daemon running?
```
- colima: /bin/sh: colima: command not found
- ollama_version: /bin/sh: ollama: command not found
- ollama_models: /bin/sh: ollama: command not found
- ollama_api_configured_address: unreachable; http://100.107.140.12:11434/api/tags: URLError; http://192.168.4.28:11434/api/tags: URLError
- python: Python 3.14.3
- tesseract: /bin/sh: tesseract: command not found
- paddleocr: missing
- mlx: missing
- mlx_vlm: missing
- gpu:

```text
Graphics/Displays:

    Apple M4:

      Chipset Model: Apple M4
      Type: GPU
      Bus: Built-In
      Total Number of Cores: 10
      Vendor: Apple (0x106b)
      Metal Support: Metal 4
      Displays:
        HISENSE:
          Resolution: 3840 x 2160 (2160p/4K UHD 1 - Ultra High Definition)
          UI Looks like: 1920 x 1080 @ 60.00Hz
          Main Display: Yes
          Mirror: Off
          Online: Yes
          Rotation: Supported
          Display Asleep: Yes
          Television: Yes
```
- listening_tcp:

```text
COMMAND     PID      USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node       1459 factorylm   14u  IPv6 0x2a205ca92fdcb9c6      0t0  TCP *:3333 (LISTEN)
IPNExtens 38974 factorylm   10u  IPv4 0x7bcc446fd46a8907      0t0  TCP 127.0.0.1:51722 (LISTEN)
IPNExtens 38974 factorylm   28u  IPv4 0xcc1657a1fc4f4cb3      0t0  TCP *:443 (LISTEN)
IPNExtens 38974 factorylm   30u  IPv6 0xc79878981de42932      0t0  TCP *:443 (LISTEN)
IPNExtens 38974 factorylm   38u  IPv4 0xd7ce1c9d54d5b276      0t0  TCP *:59071 (LISTEN)
IPNExtens 38974 factorylm   39u  IPv6 0x50d8be981081dcbb      0t0  TCP *:58629 (LISTEN)
ARDAgent  39063 factorylm   10u  IPv6 0x227656700f92ff11      0t0  TCP *:3283 (LISTEN)
node      39098 factorylm   16u  IPv4 0xfc8613a6d9c27cd8      0t0  TCP 127.0.0.1:18789 (LISTEN)
node      39098 factorylm   17u  IPv6 0x4fc8a9604e4deada      0t0  TCP [::1]:18789 (LISTEN)
node      39098 factorylm   23u  IPv4 0xd3cefdca8cfe6e2c      0t0  TCP 127.0.0.1:18791 (LISTEN)
node      39098 factorylm   27u  IPv4 0x3102176bacec3794      0t0  TCP 127.0.0.1:18792 (LISTEN)
redis-ser 39101 factorylm    6u  IPv4 0x51c2b398676640aa      0t0  TCP 127.0.0.1:6379 (LISTEN)
redis-ser 39101 factorylm    7u  IPv6 0xedf43c31955177db      0t0  TCP [::1]:6379 (LISTEN)
Python    39195 factorylm    7u  IPv4  0x34fe41fd6493034      0t0  TCP *:7200 (LISTEN)
bun       39241 factorylm    7u  IPv4 0xa902d09553696503      0t0  TCP *:7899 (LISTEN)
```
- load: 7:05  up 76 days, 12:58, 3 users, load averages: 1.17 1.17 1.16

### bravo
- cpu: Apple M4
- memory_free:

```text
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               24163.
Pages active:                            364824.
Pages inactive:                          360651.
Pages speculative:                         3170.
Pages throttled:                              0.
Pages wired down:                        136403.
Pages purgeable:                            410.
```
- external_volumes:

```text
FactoryLM
Macintosh HD
```
- docker: Docker version 29.2.1, build a5c7197
- docker_info:

```text
"" 0 0
Cannot connect to the Docker daemon at unix:///Users/bravonode/.docker/run/docker.sock. Is the docker daemon running?
```
- colima: /bin/sh: colima: command not found
- ollama_version:

```text
Warning: could not connect to a running Ollama instance
Warning: client version is 0.22.0
```
- ollama_models: Error: could not connect to ollama server, run 'ollama serve' to start it
- ollama_api_configured_address: http://100.86.236.11:11434/api/tags => gemma4:e4b, glm-ocr:latest, qwen2.5vl:7b, mira:latest, nomic-embed-text:latest
- python: Python 3.14.4
- tesseract: /bin/sh: tesseract: command not found
- paddleocr: missing
- mlx: missing
- mlx_vlm: missing
- gpu:

```text
Graphics/Displays:

    Apple M4:

      Chipset Model: Apple M4
      Type: GPU
      Bus: Built-In
      Total Number of Cores: 10
      Vendor: Apple (0x106b)
      Metal Support: Metal 4
      Displays:
        Acer P191W:
          Resolution: 1440 x 900 (Widescreen eXtended Graphics Array Plus)
          UI Looks like: 1440 x 900 @ 75.00Hz
          Main Display: Yes
          Mirror: Off
          Online: Yes
          Rotation: Supported
```
- listening_tcp:

```text
COMMAND     PID      USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
rapportd    381 bravonode   10u  IPv4 0x2819a3be7e27646b      0t0  TCP *:49152 (LISTEN)
rapportd    381 bravonode   11u  IPv6 0x7909b244a1546729      0t0  TCP *:49152 (LISTEN)
ControlCe   411 bravonode   10u  IPv4 0x26cc38106359474b      0t0  TCP *:7000 (LISTEN)
ControlCe   411 bravonode   11u  IPv6  0x83ebc18709c3540      0t0  TCP *:7000 (LISTEN)
ControlCe   411 bravonode   12u  IPv4 0xd5eb1769fe8044c6      0t0  TCP *:5000 (LISTEN)
ControlCe   411 bravonode   13u  IPv6 0x51a6f828cb467550      0t0  TCP *:5000 (LISTEN)
ARDAgent    648 bravonode   10u  IPv6  0x85527099450476c      0t0  TCP *:3283 (LISTEN)
redis-ser   824 bravonode    6u  IPv4 0xf22bd23f3b8cc895      0t0  TCP 127.0.0.1:6379 (LISTEN)
redis-ser   824 bravonode    7u  IPv6 0x1c7135c69c888067      0t0  TCP [::1]:6379 (LISTEN)
redis-ser   824 bravonode    8u  IPv4 0x2bd0d65ffb41de99      0t0  TCP 192.168.1.11:6379 (LISTEN)
postgres    832 bravonode    7u  IPv6 0x28fb6cc49a5c50aa      0t0  TCP [::1]:5432 (LISTEN)
postgres    832 bravonode    8u  IPv4 0x1b07d7a42a86b019      0t0  TCP 127.0.0.1:5432 (LISTEN)
bun        1720 bravonode    7u  IPv4 0x980b82117cb9a132      0t0  TCP 127.0.0.1:7899 (LISTEN)
python3.1  4387 bravonode    8u  IPv4 0x9ecda1c0e57b5c03      0t0  TCP 127.0.0.1:53539 (LISTEN)
ollama    75233 bravonode    4u  IPv4 0xf5f7b8b7825146b5      0t0  TCP 100.86.236.11:11434 (LISTEN)
```
- load: 7:05  up 20 days, 11:21, 3 users, load averages: 2.37 1.85 1.97

### charlie
- cpu: Apple M4
- memory_free:

```text
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                3530.
Pages active:                            212777.
Pages inactive:                          210659.
Pages speculative:                          987.
Pages throttled:                              0.
Pages wired down:                        156852.
Pages purgeable:                              4.
```
- external_volumes:

```text
Macintosh HD
T7
```
- docker: Docker version 29.2.1, build a5c7197d72
- docker_info: "29.2.1" 2 2054303744
- colima:

```text
time="2026-07-18T07:05:24-04:00" level=info msg="colima is running using macOS Virtualization.Framework"
time="2026-07-18T07:05:24-04:00" level=info msg="arch: aarch64"
time="2026-07-18T07:05:24-04:00" level=info msg="runtime: docker"
time="2026-07-18T07:05:24-04:00" level=info msg="mountType: virtiofs"
time="2026-07-18T07:05:24-04:00" level=info msg="docker socket: unix:///Users/charlienode/.colima/default/docker.sock"
time="2026-07-18T07:05:24-04:00" level=info msg="containerd socket: unix:///Users/charlienode/.colima/default/containerd.sock"
```
- ollama_version: ollama version is 0.20.2
- ollama_models:

```text
NAME                       ID              SIZE      MODIFIED
nomic-embed-text:latest    0a109f422b47    274 MB    7 weeks ago
gemma4:e4b                 c6eb396dbd59    9.6 GB    3 months ago
qwen2.5:7b                 845dbda0ea48    4.7 GB    3 months ago
nomic-embed-text:v1.5      0a109f422b47    274 MB    3 months ago
```
- ollama_api_configured_address: http://100.70.49.126:11434/api/tags => nomic-embed-text:latest, gemma4:e4b, qwen2.5:7b, nomic-embed-text:v1.5
- python: Python 3.14.4
- tesseract: /bin/sh: tesseract: command not found
- paddleocr: missing
- mlx: present
- mlx_vlm: missing
- gpu:

```text
Graphics/Displays:

    Apple M4:

      Chipset Model: Apple M4
      Type: GPU
      Bus: Built-In
      Total Number of Cores: 10
      Vendor: Apple (0x106b)
      Metal Support: Metal 4
      Displays:
        Acer X223W:
          Resolution: 1680 x 1050 (Widescreen Super eXtended Graphics Array Plus)
          UI Looks like: 1680 x 1050 @ 60.00Hz
          Main Display: Yes
          Mirror: Off
          Online: Yes
          Rotation: Supported
```
- listening_tcp:

```text
COMMAND     PID        USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
rapportd    710 charlienode    6u  IPv4 0xb192241225654cee      0t0  TCP *:49502 (LISTEN)
rapportd    710 charlienode    7u  IPv6 0x7ef1a2a807da4b12      0t0  TCP *:49502 (LISTEN)
ARDAgent    733 charlienode    9u  IPv6 0xbdfdc48096037b4c      0t0  TCP *:3283 (LISTEN)
ControlCe   767 charlienode    9u  IPv4 0xd9996436aee22aad      0t0  TCP *:7000 (LISTEN)
ControlCe   767 charlienode   10u  IPv6 0x5665589df766b218      0t0  TCP *:7000 (LISTEN)
ControlCe   767 charlienode   11u  IPv4 0x7da026300678b965      0t0  TCP *:5000 (LISTEN)
ControlCe   767 charlienode   12u  IPv6 0x2a64da80e3449836      0t0  TCP *:5000 (LISTEN)
Python     1016 charlienode    7u  IPv4 0x3820570a3b2bbc5f      0t0  TCP 100.70.49.126:8765 (LISTEN)
ollama     1018 charlienode    3u  IPv6 0x5d08c9e9bd9e10dc      0t0  TCP *:11434 (LISTEN)
python3.1  1083 charlienode   11u  IPv4  0xa40f5aa8bab6a7f      0t0  TCP *:8500 (LISTEN)
autossh   27250 charlienode    3u  IPv4  0x544fbaee73f3a2c      0t0  TCP 127.0.0.1:8902 (LISTEN)
limactl   54209 charlienode   13u  IPv4 0xdaab054ecbeff0a3      0t0  TCP 127.0.0.1:62134 (LISTEN)
limactl   54210 charlienode    8u  IPv6 0x47afb8873ab68af8      0t0  TCP *:53 (LISTEN)
ssh       54233 charlienode   10u  IPv4 0x6b3ce8a86c4d71fd      0t0  TCP *:1880 (LISTEN)
ssh       54233 charlienode   13u  IPv4 0xef03e3dff82289c6      0t0  TCP 127.0.0.1:8009 (LISTEN)
ssh       54233 charlienode   14u  IPv4 0x5b65410c8bdd1c99      0t0  TCP 127.0.0.1:8001 (LISTEN)
ssh       54233 charlienode   15u  IPv4 0xbd00d14d8532db0f      0t0  TCP 127.0.0.1:8010 (LISTEN)
ssh       54233 charlienode   16u  IPv4 0xcfe2838295446cf3      0t0  TCP *:1883 (LISTEN)
ssh       54233 charlienode   17u  IPv4 0xaa0ae02bebb5e745      0t0  TCP *:3000 (LISTEN)
ssh       54233 charlienode   18u  IPv4 0x982903e4f68c7b48      0t0  TCP *:6379 (LISTEN)
ssh       54233 charlienode   20u  IPv4  0xcf3edf2d8b98fb0      0t0  TCP 127.0.0.1:3101 (LISTEN)
ssh       54233 charlienode   21u  IPv4 0x24a38afd137b138c      0t0  TCP 127.0.0.1:8002 (LISTEN)
ssh       54233 charlienode   22u  IPv4 0x4624bf4e45335547      0t0  TCP 127.0.0.1:9099 (LISTEN)
Python    55993 charlienode   11u  IPv4 0x25f415f69ed7d31b      0t0  TCP *:8090 (LISTEN)
Python    88673 charlienode    3u  IPv4 0xeede178930a9c095      0t0  TCP 127.0.0.1:8931 (LISTEN)
```
- load: 7:05  up 20 days, 11:21, 5 users, load averages: 5.32 5.37 4.97

### vps
- cpu: DO-Premium-AMD
- memory_free: 3079016 kB
- external_volumes:

```text
/sys 0 0
/proc 0 0
/dev 3.9G 3.9G
/dev/pts 0 0
/run 794.1M 789.7M
/ 153.9G 57.3G
/sys/kernel/security 0 0
/dev/shm 3.9G 3.9G
/run/lock 5M 5M
/sys/fs/cgroup 0 0
/sys/fs/pstore 0 0
/sys/fs/bpf 0 0
/proc/sys/fs/binfmt_misc 0 0
/dev/hugepages 0 0
/dev/mqueue 0 0
/sys/kernel/debug 0 0
/sys/kernel/tracing 0 0
/sys/fs/fuse/connections 0 0
/sys/kernel/config 0 0
/boot 880.4M 702.2M
```
- docker: Docker version 29.2.0, build 0b9d198
- docker_info: "29.2.0" 4 8326946816
- colima: /bin/sh: 1: colima: not found
- ollama_version: ollama version is 0.20.0
- ollama_models:

```text
NAME                       ID              SIZE      MODIFIED
qwen2.5vl:7b               5ced39dfa4ba    6.0 GB    2 months ago
nomic-embed-text:latest    0a109f422b47    274 MB    3 months ago
```
- ollama_api_configured_address: http://100.68.120.99:11434/api/tags => qwen2.5vl:7b, nomic-embed-text:latest
- python: Python 3.12.3
- tesseract: tesseract 5.3.4
- paddleocr: missing
- mlx: missing
- mlx_vlm: missing
- gpu: missing
- listening_tcp:

```text
COMMAND       PID            USER   FD   TYPE   DEVICE SIZE/OFF NODE NAME
systemd         1            root  280u  IPv4     8254      0t0  TCP *:22 (LISTEN)
systemd         1            root  283u  IPv6     7449      0t0  TCP *:22 (LISTEN)
systemd-r     682 systemd-resolve   15u  IPv4     6493      0t0  TCP 127.0.0.53:53 (LISTEN)
systemd-r     682 systemd-resolve   17u  IPv4     6495      0t0  TCP 127.0.0.54:53 (LISTEN)
python3       829            root   13u  IPv4     8893      0t0  TCP *:8400 (LISTEN)
celery        839            root    7u  IPv4     9948      0t0  TCP *:5555 (LISTEN)
python        845            root    6u  IPv4    10006      0t0  TCP *:8081 (LISTEN)
python        855            root   13u  IPv4     9860      0t0  TCP *:3000 (LISTEN)
ollama        857          ollama    3u  IPv6     7924      0t0  TCP *:11434 (LISTEN)
uvicorn       860            root   16u  IPv4    11539      0t0  TCP *:8100 (LISTEN)
tailscale     873            root   23u  IPv4    10941      0t0  TCP 100.68.120.99:48914 (LISTEN)
tailscale     873            root   24u  IPv6    10943      0t0  TCP [fd7a:115c:a1e0::9f37:7863]:59675 (LISTEN)
syncthing     993            root   12u  IPv6     8734      0t0  TCP *:22000 (LISTEN)
syncthing     993            root   18u  IPv4     8765      0t0  TCP 127.0.0.1:8384 (LISTEN)
nginx        1017            root    5u  IPv4     9543      0t0  TCP *:443 (LISTEN)
nginx        1017            root    6u  IPv4     9544      0t0  TCP *:80 (LISTEN)
nginx        1017            root    7u  IPv4     9545      0t0  TCP *:8089 (LISTEN)
nginx        1018        www-data    5u  IPv4     9543      0t0  TCP *:443 (LISTEN)
nginx        1018        www-data    6u  IPv4     9544      0t0  TCP *:80 (LISTEN)
nginx        1018        www-data    7u  IPv4     9545      0t0  TCP *:8089 (LISTEN)
nginx        1019        www-data    5u  IPv4     9543      0t0  TCP *:443 (LISTEN)
nginx        1019        www-data    6u  IPv4     9544      0t0  TCP *:80 (LISTEN)
nginx        1019        www-data    7u  IPv4     9545      0t0  TCP *:8089 (LISTEN)
nginx        1022        www-data    5u  IPv4     9543      0t0  TCP *:443 (LISTEN)
nginx        1022        www-data    6u  IPv4     9544      0t0  TCP *:80 (LISTEN)
nginx        1022        www-data    7u  IPv4     9545      0t0  TCP *:8089 (LISTEN)
nginx        1023        www-data    5u  IPv4     9543      0t0  TCP *:443 (LISTEN)
nginx        1023        www-data    6u  IPv4     9544      0t0  TCP *:80 (LISTEN)
nginx        1023        www-data    7u  IPv4     9545      0t0  TCP *:8089 (LISTEN)
python       1053            root   15u  IPv4    11561      0t0  TCP *:8340 (LISTEN)
docker-pr    3163            root    8u  IPv4    15520      0t0  TCP 127.0.0.1:5433 (LISTEN)
docker-pr    3551            root    8u  IPv4    16094      0t0  TCP 127.0.0.1:5180 (LISTEN)
docker-pr    3878            root    8u  IPv4    17402      0t0  TCP 127.0.0.1:9002 (LISTEN)
docker-pr    3967            root    8u  IPv4    20699      0t0  TCP 127.0.0.1:9003 (LISTEN)
docker-pr    4064            root    8u  IPv4    20207      0t0  TCP *:1883 (LISTEN)
docker-pr    4081            root    8u  IPv6    20208      0t0  TCP *:1883 (LISTEN)
docker-pr    4136            root    8u  IPv4    20897      0t0  TCP *:9001 (LISTEN)
docker-pr    4162            root    8u  IPv6    20898      0t0  TCP *:9001 (LISTEN)
docker-pr    4299            root    8u  IPv4    21037      0t0  TCP 127.0.0.1:8090 (LISTEN)
```
- load: 11:05:25 up 3 days, 12:19,  1 user,  load average: 2.51, 1.72, 1.40

## Resource-gated next actions

- Treat Bravo as the primary interactive local VLM/OCR lane when its configured-address Ollama API reports the required models.
- Treat Charlie as the document OCR/layout, embeddings/retrieval, batch corpus, and benchmark lane; keep work asynchronous and resource-limited.
- Install or enable Tesseract, PaddleOCR, and MLX-VLM only in pinned, license-checked follow-up PRs with before/after benchmarks.
- Keep the VPS on ingress, job state, manifests, and cache metadata; do not route routine heavy VLM work there.

## Charlie-owned implementation lane

Charlie should own document OCR/layout, embeddings/retrieval, batch corpus work, benchmark and dataset curation, and a second 4B-class local VLM lane only when live memory/load evidence says it will not degrade MIRA services.
