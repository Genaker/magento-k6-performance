# Magento 2 K6-performance toolkit

k6 Magento 2 is a modern performance under load-testing tool when more than one user hits your page, built on years of experience in the Magento 2 performance and testing industries. It's built to be powerful, extensible, and full-featured. The key design goal is to provide the best developer experience.

![New Project (17)](https://github.com/Genaker/magento-k6-performance/assets/9213670/73f0334f-ea2f-40fe-9ae9-5c3e6bd285cd)

## Installation

```
# Download ARM binary
wget https://github.com/grafana/k6/releases/download/v0.50.0/k6-v0.50.0-linux-arm64.tar.gz

# Extract
tar -xvzf k6-v0.50.0-linux-arm64.tar.gz
sudo mv k6-v0.50.0-linux-arm64/k6 /usr/local/bin/

# Verify
k6 version
```

## Linux
## Debian/Ubuntu
```
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

If you are behind a firewall or proxy
There have been reports of users being unable to download the key from Ubuntu's key-server using apt-key command due to firewalls or proxies blocking their requests. If you experience this issue, you may try this alternative approach instead:
```
wget -q -O - https://bintray.com/user/downloadSubjectPublicKey?username=bintray | sudo apt-key add -
```
or just install script
```
bash install-ubuntu.sh
```
## Red Hat/CentOS
```
wget https://bintray.com/loadimpact/rpm/rpm -O bintray-loadimpact-rpm.repo
sudo mv bintray-loadimpact-rpm.repo /etc/yum.repos.d/
sudo yum install k6
```
## Mac (brew)

## Brew
```
brew install k6
```
## Docker
```
docker pull loadimpact/k6
```

# Usage with Magento 

```
k6 run magento.js -e url=https://example.com -u 200 -i 6000 --include-system-env-vars=false
```
Where:

magento.js - script name  
-e url= site URL to test as env variable  
-e sleep=0.2 etc. add sleep after HTTP response
-u virtual users / concurrency / threads  
-i number of iteration  
--include-system-env-vars=false - don't include OS/system env variables  

# Load Testing Guide

## Installation
```bash
# Install k6
sudo apt-get update && sudo apt-get install k6

# Verify installation
k6 version
```

## Basic Test Scenarios

### 1. Quick Smoke Test
```bash
k6 run -e URL="http://yoursite.com/product/36" \
  --vus 10 --duration 30s \
  magento.js
```

### 2. Average Load Simulation
```bash
k6 run -e URL="http://yoursite.com/product/36" \
  --vus 100 --duration 5m \
  magento.js
```

### 3. Peak Load Stress Test
```bash
k6 run -e URL="http://yoursite.com/product/36" \
  --vus 500 --duration 10m \
  --rps 200 \
  magento.js
```

## Advanced Scenarios

### 4. Ramp-up Pattern
```bash
k6 run -e URL="http://yoursite.com/product/36" \
  --stage 2m:200 --stage 5m:200 --stage 1m:0 \
  magento.js
```

### 5. Spike Testing
```bash
k6 run -e URL="http://yoursite.com/product/36" \
  --stage 30s:1000 --stage 1m:1000 --stage 30s:50 \
  magento.js
```

## Configuration Options

### Environment Variables
| Variable    | Description                | Default     |
|-------------|----------------------------|-------------|
| `URL`       | Target endpoint            | Required    |
| `METHOD`    | HTTP Method                | `GET`       |
| `N`         | Iterations per VU          | `1`         |
| `SLEEP`     | Delay between requests (s) | `0`         |
| `FPC`       | Full Page Cache            | `OFF`       |
| `USERNAME`  | Basic Auth username        | -           |
| `PASSWORD`  | Basic Auth password        | -           |

## Example Command with All Options
```bash
k6 run \
  -e URL="http://yoursite.com/product/36" \
  -e METHOD=GET \
  -e N=5 \
  -e SLEEP=0.5 \
  -e FPC=ON \
  -e USERNAME=test -e PASSWORD=test123 \
  --vus 200 \
  --duration 10m \
  --rps 100 \
  --out json=metrics.json \
  magento.js
```

## Results Interpretation

Key metrics to monitor:
- **VUs**: Active virtual users
- **iterations**: Completed requests
- **http_req_duration**: Response times
  - p(95): 95th percentile
  - max: Maximum response time
- **http_req_failed**: Error rate
- **rps**: Requests per second

## Generating Reports

1. JSON output:
```bash
k6 run --out json=results.json magento.js
```

2. HTML report (requires k6-html-reporter):
```bash
k6 run --out json=results.json magento.js
npx k6-html-reporter -i results.json -o report.html
```

## Best Practices

1. Start with low VUs and gradually increase
2. Monitor application metrics during tests
3. Run tests from different locations
4. Combine with cache busting (FPC=OFF)
5. Test different endpoints simultaneously

## Troubleshooting

**Common Errors**:
- `405 Method Not Allowed`: Ensure correct HTTP method case (UPPERCASE)
- `429 Too Many Requests`: Reduce RPS/VUs
- `500 Errors`: Check application logs

**Debug Command**:
```bash
k6 run -e URL="http://yoursite.com/product/36" \
  --http-debug=full \
  --vus 1 --iterations 1 \
  magento.js
```

# Full K6 documentation

[https://k6.io/docs/](https://k6.io/docs/)

