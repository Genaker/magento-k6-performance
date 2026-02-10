# 🚀 Magento 2 K6 Performance Testing Toolkit - Load & Stress Testing Made Easy

[![K6 Version](https://img.shields.io/badge/k6-v0.50.0-7d64ff?style=flat-square&logo=k6)](https://k6.io/)
[![Magento 2](https://img.shields.io/badge/Magento-2.x-FF6C37?style=flat-square&logo=magento)](https://magento.com/)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/Genaker/magento-k6-performance?style=flat-square)](https://github.com/Genaker/magento-k6-performance/stargazers)

**Professional load testing and performance benchmarking tool for Magento 2 e-commerce stores.** Built with K6, the modern open-source load testing framework trusted by developers worldwide.

![Magento K6 Performance Testing](https://github.com/Genaker/magento-k6-performance/assets/9213670/73f0334f-ea2f-40fe-9ae9-5c3e6bd285cd)

## 🎯 Why Choose This Toolkit?

Performance testing is critical for e-commerce success. This toolkit provides:

- **⚡ Fast & Reliable**: Modern load testing powered by K6's high-performance engine
- **🎨 Developer-Friendly**: Simple JavaScript-based scripts, easy to customize
- **📊 Detailed Metrics**: Real-time performance insights with p95, p99 percentiles
- **🔧 Flexible Configuration**: Test any Magento 2 endpoint with customizable parameters
- **🌐 Production-Ready**: Simulate real-world traffic patterns and user behavior
- **🔐 Secure Testing**: Built-in support for Basic Authentication and SSL
- **📈 Scalable**: Test from 1 to 10,000+ concurrent virtual users

Perfect for DevOps engineers, Magento developers, performance testers, and e-commerce managers who need to ensure their Magento 2 store can handle Black Friday traffic, marketing campaigns, or steady growth.

## 📋 Table of Contents

- [Features](#-key-features)
- [Quick Start](#-quick-start)
- [Installation](#-installation-guide)
- [Usage Examples](#-usage-examples)
- [Configuration](#-configuration-options)
- [Load Testing Scenarios](#-load-testing-scenarios)
- [Metrics & Reports](#-understanding-metrics--reports)
- [Troubleshooting](#-troubleshooting)
- [Best Practices](#-best-practices)
- [FAQ](#-frequently-asked-questions)
- [Contributing](#-contributing)
- [License](#-license)

## ✨ Key Features

- **Zero Configuration Required**: Works out of the box with sensible defaults
- **Multiple HTTP Methods**: Support for GET, POST, PUT, DELETE, PATCH
- **Cache Control**: Test with Full Page Cache (FPC) enabled or disabled
- **Authentication**: Built-in Basic Auth support for staging environments
- **Flexible Metrics**: Custom response time trends and error rate tracking
- **Realistic Traffic Simulation**: Configurable sleep times between requests
- **Multiple OS Support**: Linux, macOS, Windows, and Docker
- **CI/CD Integration**: Perfect for automated performance testing pipelines

## 🚀 Quick Start

Get started in 3 simple steps:

```bash
# 1. Install K6
brew install k6  # macOS
# OR
sudo apt-get install k6  # Ubuntu/Debian

# 2. Download the script
wget https://raw.githubusercontent.com/Genaker/magento-k6-performance/main/magento.js

# 3. Run your first test
k6 run magento.js -e URL=https://your-magento-store.com/product/123 --vus 10 --duration 30s
```

That's it! You'll see real-time metrics showing how your Magento store performs under load.

## 📦 Installation Guide

### Linux ARM64

```bash
# Download ARM binary
wget https://github.com/grafana/k6/releases/download/v0.50.0/k6-v0.50.0-linux-arm64.tar.gz

# Extract
tar -xvzf k6-v0.50.0-linux-arm64.tar.gz
sudo mv k6-v0.50.0-linux-arm64/k6 /usr/local/bin/

# Verify
k6 version
```

### Debian/Ubuntu (Recommended)

```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

**Alternative for Firewall/Proxy Users**:

If you're behind a firewall or proxy that blocks keyserver access:
```
wget -q -O - https://bintray.com/user/downloadSubjectPublicKey?username=bintray | sudo apt-key add -
```

**Quick Installation Script**:

```bash
bash install-ubuntu.sh
```

### Red Hat/CentOS

```bash
wget https://bintray.com/loadimpact/rpm/rpm -O bintray-loadimpact-rpm.repo
sudo mv bintray-loadimpact-rpm.repo /etc/yum.repos.d/
sudo yum install k6
```

### macOS (Homebrew)

```bash
brew install k6
```

### Docker

```bash
docker pull loadimpact/k6
```

## 💻 Usage Examples

### Basic Usage with Magento 2

```bash
k6 run magento.js -e url=https://example.com -u 200 -i 6000 --include-system-env-vars=false
```

**Parameter Explanation**:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `magento.js` | Script filename | - |
| `-e URL=` | Target URL to test | `https://example.com/product/123` |
| `-e SLEEP=` | Delay after each request (seconds) | `0.2` |
| `-u` or `--vus` | Virtual users (concurrent threads) | `200` |
| `-i` or `--iterations` | Total number of requests | `6000` |
| `--duration` | Test duration | `30s`, `5m`, `1h` |
| `--include-system-env-vars=false` | Exclude OS environment variables | Recommended for clean tests |

## ⚙️ Configuration Options

### Environment Variables Explained

| Variable    | Description                | Default     |
|-------------|----------------------------|-------------|
| `URL`       | Target endpoint            | Required    |
| `METHOD`    | HTTP Method                | `GET`       |
| `N`         | Iterations per VU          | `1`         |
| `SLEEP`     | Delay between requests (s) | `0`         |
| `FPC`       | Full Page Cache            | `OFF`       |
| `USERNAME`  | Basic Auth username        | -           |
| `PASSWORD`  | Basic Auth password        | -           |

### Complete Example with All Options

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

## 🎯 Load Testing Scenarios

### Scenario 1: Quick Smoke Test (Development)

Test if your Magento store responds correctly with minimal load:

```bash
k6 run -e URL="https://yoursite.com/product/36" \
  --vus 10 --duration 30s \
  magento.js
```

**Use Case**: Quick validation after deployments, basic functionality check

### Scenario 2: Average Load Simulation (Daily Traffic)

Simulate typical daily traffic patterns:

```bash
k6 run -e URL="https://yoursite.com/product/36" \
  --vus 100 --duration 5m \
  magento.js
```

**Use Case**: Baseline performance testing, capacity planning

### Scenario 3: Peak Load Stress Test (Black Friday)

Test maximum capacity with high concurrent users:

```bash
k6 run -e URL="https://yoursite.com/product/36" \
  --vus 500 --duration 10m \
  --rps 200 \
  magento.js
```

**Use Case**: Prepare for sales events, traffic spikes, marketing campaigns

### Scenario 4: Ramp-Up Pattern (Gradual Load Increase)

Gradually increase load to find breaking points:

```bash
k6 run -e URL="https://yoursite.com/product/36" \
  --stage 2m:200 --stage 5m:200 --stage 1m:0 \
  magento.js
```

**Use Case**: Identify bottlenecks, understand scaling behavior

### Scenario 5: Spike Testing (Sudden Traffic)

Simulate sudden traffic spikes:

```bash
k6 run -e URL="https://yoursite.com/product/36" \
  --stage 30s:1000 --stage 1m:1000 --stage 30s:50 \
  magento.js
```

**Use Case**: Test recovery from sudden load, validate auto-scaling

## 📊 Understanding Metrics & Reports

### Key Performance Indicators


### Key Performance Indicators

Monitor these critical metrics during your tests:

- **VUs (Virtual Users)**: Number of active concurrent users
- **iterations**: Total completed requests across all users
- **http_req_duration**: Response time statistics
  - **avg**: Average response time
  - **p(95)**: 95% of requests complete within this time
  - **p(99)**: 99% of requests complete within this time
  - **max**: Slowest response time
- **http_req_failed**: Percentage of failed requests (errors)
- **http_reqs**: Requests per second (throughput)
- **data_received**: Bandwidth consumed (MB/s)

### Generating Reports

**1. JSON Output for Analysis**:

```bash
k6 run --out json=results.json magento.js
```

**2. HTML Report (Visual Dashboard)**:

```bash
k6 run --out json=results.json magento.js
npx k6-html-reporter -i results.json -o report.html
```

**3. Export to InfluxDB or Grafana** (for real-time monitoring):

```bash
k6 run --out influxdb=http://localhost:8086/k6 magento.js
```

## 🎓 Best Practices for Magento Performance Testing

## 🎓 Best Practices for Magento Performance Testing

### Testing Strategy

1. **Start Small, Scale Gradually**: Begin with 10-50 VUs, then increase incrementally
2. **Test Production-Like Environments**: Use staging servers with production data volumes
3. **Monitor Application Metrics**: Watch MySQL, Redis, Elasticsearch alongside K6 metrics
4. **Test Different Endpoints**: Homepage, category pages, product pages, checkout, search
5. **Vary Cache Conditions**: Test both with FPC enabled (`FPC=ON`) and cache-busted (`FPC=OFF`)
6. **Geographic Distribution**: Run tests from multiple locations if serving global customers
7. **Baseline First**: Establish performance baselines before making changes

### Common Pitfalls to Avoid

- ❌ Testing only homepage (test all critical user journeys)
- ❌ Testing from same datacenter as your server (unrealistic network latency)
- ❌ Ignoring database and cache server load
- ❌ Not monitoring error rates (200 OK doesn't mean quality)
- ❌ Running tests during production hours

## 🔧 Troubleshooting Common Issues

## 🔧 Troubleshooting Common Issues

### Problem: "Missing required URL parameter"

**Solution**: Always provide the URL parameter:
```bash
k6 run -e URL="https://yoursite.com/product/123" magento.js
```

### Problem: 405 Method Not Allowed

**Cause**: HTTP method must be UPPERCASE  
**Solution**: Use `-e METHOD=GET` or `-e METHOD=POST` (uppercase)

### Problem: 429 Too Many Requests

**Cause**: Rate limiting or DDoS protection triggered  
**Solution**: Reduce VUs or RPS:
```bash
k6 run -e URL="..." --vus 50 --rps 50 magento.js
```

### Problem: 500 Internal Server Errors

**Cause**: Application cannot handle the load  
**Solution**:
1. Check Magento logs (`var/log/`)
2. Monitor PHP-FPM, MySQL, Redis
3. Reduce load and identify bottleneck
4. Scale resources or optimize code

### Problem: SSL Certificate Errors

**Solution**: The script already includes `insecureSkipTLSVerify: true`, but if issues persist:
```bash
k6 run --insecure-skip-tls-verify -e URL="..." magento.js
```

### Debug Mode

Enable full HTTP debugging to see request/response details:

```bash
k6 run -e URL="http://yoursite.com/product/36" \
  --http-debug=full \
  --vus 1 --iterations 1 \
  magento.js
```

## ❓ Frequently Asked Questions

### What's the difference between VUs and iterations?

**VUs (Virtual Users)** are concurrent users simulating real traffic. **Iterations** are the total number of requests each VU will make. For example, `--vus 100 --iterations 1000` means 100 users will collectively make 1000 requests.

### Should I test with FPC ON or OFF?

- **FPC=ON**: Tests your cache performance (realistic for pages already cached)
- **FPC=OFF**: Tests your server's ability to generate pages (worst-case scenario)

For comprehensive testing, run both scenarios.

### How many VUs should I use?

Start with your expected peak concurrent users. For e-commerce:
- **Small store**: 10-50 VUs
- **Medium store**: 100-300 VUs
- **Large store**: 500-2000+ VUs

Google Analytics can help estimate your peak concurrent users.

### What's a good response time for Magento 2?

Performance targets:
- **Excellent**: < 500ms (with FPC)
- **Good**: 500-1000ms
- **Acceptable**: 1-2 seconds
- **Poor**: > 2 seconds

Without FPC, expect 2-5x longer response times.

### Can I test POST requests (like checkout)?

Yes! Use:
```bash
k6 run -e URL="https://yoursite.com/checkout" -e METHOD=POST magento.js
```

For complex scenarios, modify `magento.js` to include form data.

### How does this compare to JMeter or LoadRunner?

K6 advantages:
- ✅ Lightweight and fast (written in Go)
- ✅ Modern developer experience (JavaScript/ES6)
- ✅ Better resource efficiency
- ✅ Easy CI/CD integration
- ✅ Free and open-source

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Report Issues**: Found a bug? [Open an issue](https://github.com/Genaker/magento-k6-performance/issues)
2. **Improve Documentation**: Submit PRs for better examples or clearer explanations
3. **Add Features**: Enhance the test script with new capabilities
4. **Share Results**: Post your performance findings in discussions

### Development

```bash
# Clone the repository
git clone https://github.com/Genaker/magento-k6-performance.git
cd magento-k6-performance

# Make your changes to magento.js

# Test your changes
k6 run magento.js -e URL=https://example.com --vus 10 --duration 30s
```

## 📚 Additional Resources

- **Official K6 Documentation**: [k6.io/docs](https://k6.io/docs/)
- **Magento Performance Best Practices**: [Adobe Commerce Performance Best Practices Guide](https://experienceleague.adobe.com/docs/commerce-operations/performance-best-practices/overview.html)
- **K6 Extensions**: [k6.io/docs/extensions](https://k6.io/docs/extensions/)
- **Load Testing Blog**: [k6.io/blog](https://k6.io/blog/)

## 📄 License

This project is open-source and available under the MIT License.

## 🌟 Star History

If this tool helps you improve your Magento performance, please ⭐ star the repository!

## 💬 Support & Community

- **Issues**: [GitHub Issues](https://github.com/Genaker/magento-k6-performance/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Genaker/magento-k6-performance/discussions)
- **Twitter**: Share your results with #MagentoPerformance #K6

---

**Keywords**: Magento 2 performance testing, K6 load testing, Magento stress test, e-commerce performance, load testing tool, Magento benchmarking, performance optimization, K6 Magento integration, web performance testing, Magento 2 scalability

Made with ❤️ for the Magento community

