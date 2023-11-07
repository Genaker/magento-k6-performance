# Magento 2 K6-performance toolkit

k6 Magento 2 is a modern performance under load-testing tool when more than one user hits your page, built on years of experience in the Magento 2 performance and testing industries. It's built to be powerful, extensible, and full-featured. The key design goal is to provide the best developer experience.

![New Project (17)](https://github.com/Genaker/magento-k6-performance/assets/9213670/73f0334f-ea2f-40fe-9ae9-5c3e6bd285cd)

## Installation

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

# Usage with magento 

```
k6 run magento.js -e url=https://example.com -u 200 -i 6000 --include-system-env-vars=false
```
where:

magento.js - script name  
-e url= site url to test as env varriable  
-e sleep=0.2 etc. add sleep after http response
-u virtual users / concurancy / threads  
-i number of iteration  
--include-system-env-vars=false - don't include OS/system env varriables  

# Full K6 documentation

[https://k6.io/docs/](https://k6.io/docs/)

