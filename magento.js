import http from 'k6/http';
import encoding from 'k6/encoding';
import { sleep } from 'k6';

const username = 'user';
const password = 'password';

export let options = {
  discardResponseBodies: true,
  insecureSkipTLSVerify: true,
  summaryTrendStats: ['min', 'med', 'avg', 'max', 'p(95)']
};

export function setup(data) {

 console.log(JSON.stringify(__ENV));

 let method = 'get';

 if (__ENV.method != null) method =__ENV.method;

 console.log('Method: ' + method);

 let separator = '?';

 if (__ENV.url.search(/[?]/) !== -1)
 {
	separator = '&';
 }

 let sleep = 0;

 if (__ENV.sleep != null) sleep =__ENV.sleep;

 let n = 1;

 if (__ENV.n != null){
     n = __ENV.n;
 }

 return {'url': __ENV.url, 'method': method, 'separ': separator, 'n': n, 'sleep': sleep}

}

export default function (data) {
const credentials = `${username}:${password}`;

// Alternatively, you can create the header yourself to authenticate
// using HTTP Basic Auth
const encodedCredentials = encoding.b64encode(credentials);
const options = {
    headers: {
      Authorization: `Basic ${encodedCredentials}`,
    },
};

// The order of precedence is: defaults < config file < exported script options < environment variables < command-line flags. 
// Options from each subsequent level can be used to overwrite the options from the previous levels, with the CLI flags having the highest priority.

  var i = 0;
  var urls = [];

  let param = new Date().getTime();

  while (i != data.n){
     console.log('Batch ' + i + ' init : ' + param);
     let urlParam = data.separ + 'fpc_' + i + '_' + __VU + '_' + __ITER + '=' + param;
 	
     if (__ENV.fpc==='on')
	urlParam = '';

     let url = data.url + urlParam;

     urls.push({'method': data.method,   'url': url, 'params': {discardResponseBodies: true,  headers: options.headers} });
     i++;
     sleep(data.sleep);
  }

  //console.log(JSON.stringify(urls));

  var res = http.batch(urls);

  let u = 0;
  while (u != data.n){
  console.log('Response time : ' + String(res[u].timings.duration) + ' ms');
  console.log('Response status : ' + String(res[u].status));
  console.log('Response TTFB : ' + String(res[u].timings.waiting) + ' ms');
  console.log('------------------------------------');
  u++;
  }

}

export function teardown(data) {

 console.log(JSON.stringify(data));
 console.log("===============================");
 console.log('Tested URL: ' + data.url);

}
