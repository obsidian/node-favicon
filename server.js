/*
 * Node.js Favicon Service
 *
 * APPROACH
 * Taking advantage of Node's asynchronous nature, we fire off two
 * requests: one for the root favicon and one for the HTML where we parse
 * for the preferred location of the favicon.  If we don't find the favicon
 * URL in the source, we use the one at the root of the domain.
 *
 * USAGE
 * <server>/<domain or url>
 *
 * EXAMPLE
 * http://localhost:8080/www.aol.com
 *
 */

require('buffertools');
var http = require('http'),
  https = require('https'),
  url = require('url'),
  fs = require('fs'),
  imagemagick = require('imagemagick'),

  defaultFavicon;

var TIMEOUT = 15000,  // Socket timeout
  DEBUG = false,      // If true will output a metric ton of debuggig
  RETURN_DEFAULT = false,   // If true will return default favicon instead of empty response
  CACHE_TTL = 3 * 24 * 60 * 60 * 1000;  // The number of milliseconds a cache entry is considered valid

// Create the favicons directory.
if (!fs.existsSync(__dirname + '/favicons/')) {
  if (DEBUG) { console.log("Creating favicon dir"); }
  fs.mkdirSync(__dirname + '/favicons/');
}

if (!fs.existsSync(__dirname + '/favicons/tmp/')) {
  fs.mkdirSync(__dirname + '/favicons/tmp/');
}

// Keep default favicon in memory.
fs.readFile(__dirname + '/default.ico', function (err, favicon) {
  if (!err) {
    defaultFavicon = favicon;
  } else {
    console.log('Warning: Could not find default favicon in ' + __dirname + '/default.ico');
  }
});

// Downloads a favicon from a given URL
function getFavicon(faviconObj, callback) {
  var protocol;
  var url = faviconObj.url;
  url = url.substring(0, 5).toLowerCase() + url.substring(5);

  if (/https:\/\//.test(url)) {
    protocol = https;
  } else {
    protocol = http;
  }
  var req = protocol.get(url, function (res) {

    var favicon,
      chunks = [],
      length = 0;

    if (res.statusCode === 200) {
      res.on('data', function (chunk) {
        chunks.push(chunk);
        length += chunk.length;
      }).on('end', function () {
        favicon = Buffer.concat(chunks, length);
        faviconObj.data = favicon;
        callback(faviconObj);
      });
    } else if (res.statusCode === 301 || res.statusCode === 302) {
      // Fetch the favicon at the given location.
      DEBUG && console.log("Redirecting to: " + res.headers['location']);
      faviconObj.url = res.headers['location'];
      getFavicon(faviconObj, callback);
    } else {
      DEBUG && console.log("Favicon not found: " + url);
      callback(faviconObj); // undefined
    }
  }).on('error', function (err) {
    DEBUG && console.log("Error retrieving favicon " + url + ": " + err.message);
    callback(faviconObj); // undefined
  });
  req.on('socket', function (socket) {
    socket.setTimeout(TIMEOUT);  
    socket.on('timeout', function() {
        req.abort();
    });
  });
}

function saveFavicon(filename, favicon, cb) {
  fs.writeFile(filename, favicon.data, function (err) {
    if (err) {
      console.log('Error saving favicon: ' + filename);
      console.log(err.message);
    } else {
      cb (filename, favicon);
    }
  }); 
}

function getHTML(url, callback, protocol, root) {

  if (url[0] === '/') {
    if (url[1] === '/') {
      url = protocol + url;
    } else {
      url = root + url;
    }
  }

  var protocol;
  if (/https:\/\//.test(url)) {
    protocol = https;
  } else {
    protocol = http;
  }
  protocol.get(url, function (res) {

    var html,
      chunks = [],
      length = 0;

    res.setEncoding('utf-8');
    if (res.statusCode === 200) {
      res.on('data', function (chunk) {
        chunks.push(chunk);
      }).on('end', function () {
        html = chunks.join('');
        callback(html);
      });
    } else if (res.statusCode === 301 || res.statusCode === 302) {
      // console.log("Redirecting to: " + res.headers['location']);
      getHTML(res.headers['location'], callback, protocol, root);
    } else {
      callback(); // undefined
    }
  }).on('error', function (err) {
    console.log("Error retrieving " + url + ": " + err.message);
    callback();
  });
}

function fixupUrl (url, root, protocol) {
  if (url[0] === '/') {
    if (url[1] === '/') {
      url = protocol + url;
    } else {
      url = root + url;
    }
  }
  return url;
}

function parseFaviconURL(html, root, protocol) {
  var icons = [];
  var link_re = /<link ([^>]*)>/gi,
    rel_re  = /rel=["'][^"']*icon[^"']*["']/i,
    href_re = /href=["']([^"']*)["']/i,
    match, ico_match, faviconURL, tileURL, tileColor;

  while (match = link_re.exec(html)) {
    if (rel_re.test(match[1]) && (ico_match = href_re.exec(match[1]))) {
      faviconURL = ico_match[1];

      icons.push( { 'url':fixupUrl(faviconURL, root, protocol) } );
    }
  }

  var meta_re = /<meta([^>]*)>/gi,
    name_re = /name=["']msapplication-([^"']*)["']/i,
    content_re = /content=["']([^"']*)["']/i,
    content_match, name_match;

  while (match = meta_re.exec(html)) {
    name_match = name_re.exec(match[1]);
    content_match = content_re.exec(match[1]);
    if (content_match && name_match) {
      if (name_match[1] == "TileImage") {
        tileURL = content_match[1];
      } else if (name_match[1] == "TileColor") {
        tileColor = content_match[1];
      }
    }
  }
  if (tileURL) {
    if (tileColor) {
      icons.push({ 'url': fixupUrl(tileURL, root, protocol), 'bgcolor': tileColor });
    } else {
      icons.push({ 'url': fixupUrl(tileURL, root, protocol) });
    }
  }
  return icons;
}

function sendEmpty (response) {
  if (RETURN_DEFAULT) {
    response.writeHead(200, {'Content-Type': 'image/x-icon'});
    response.end(defaultFavicon);
  } else {
    response.end();
  }
}

function loadIcon (file, response) {
  // console.log(host + '.ico file stats: ', stats);
  fs.readFile(file, function (err, favicon) {
    if (!err) {
      response.writeHead(200, {'Content-Type': 'image/png'});
      response.end(favicon);
    } else {
      DEBUG && console.log('loadIcon', 'Error reading ' + file, err.message);
      sendEmpty (response);
    }
  });
}

// Initialize HTTP server.
http.globalAgent.maxSockets = 200;
http.createServer(function (request, response) {
  var urlObj = url.parse(request.url, true);
  var size = 16;
  if (urlObj.query && urlObj.query.size) {
    size = urlObj.query.size;
  }
  // console.log(urlObj);
  // Parse the request URL to identify the root.
  var root = urlObj.pathname.substr(1);

  if (root == "favicon.ico") {
      sendEmpty (response);
      return;
  }

  var host,
    // These variables help us know when both
    // requests have returned and we can complete
    // the request.
    returned = 0,
    expected = 3,
    htmlLoaded = false,
    converted = 0,
    stored = 0,
    favicons = [],
    done = function (newFavicon) {
      var favicon;
      returned += 1;
      if (newFavicon) {
        // Check to see if this favicon is already known
        var skip = false;
        for (var i in favicons) {
          var favicon = favicons[i];
          if (newFavicon.data.compare(favicon.data) == 0) {
            DEBUG && console.log ("done", "Favicon already known, skipping");
            skip = true;
            break;
          }
        }
        if (!skip) {
          favicons.push(newFavicon);
          stored++;
        }
      }

      if (returned >= expected && htmlLoaded) {
        DEBUG && console.log(" done() for " + root);

        if (stored == 0) {
          response.end();
        }
        var bestFound = false;
        var toReturn = null;
        for (var j in favicons) {
          var fi = favicons[j], orders;
          var foldername = __dirname + '/favicons/' + host + "/";
          var filename = __dirname + '/favicons/tmp/' + host + '-tmp-' + j + '.ico';

          var convertFn = function (thisFilename, fi, index) {
            if (fi.bgcolor) {
              orders = [thisFilename, "-background", fi.bgcolor, "-alpha", "on", "-flatten", "-set", "filename:area", "%w", foldername + j + '.%[filename:area].png'];
            } else {
              orders = [thisFilename, "-alpha", "on", "-set", "filename:area", "%w", foldername + j + '.%[filename:area].png'];
            }
            DEBUG && console.log ("*** Saved " + index + " to " + thisFilename, orders, fi);
            
            imagemagick.convert(orders, function (err, stdout) {
              converted++;
              if (err) {
                console.log("Cannot convert", thisFilename, foldername + '%[filename:area].png', err, stdout);
              } else {
                DEBUG && console.log(" - Converted " + converted + "/" + stored + ": " + orders[0], stdout);
              }
              if (converted == stored) {
                serveFromCache(foldername, host);
              }
            });
          };

          saveFavicon(filename, fi, convertFn);

        }
      } else {
        DEBUG && console.log(" done() for " + root + ", stored " + stored + ", E " + expected + ", R " + returned + ", still expecting " + (expected - returned) + ", html loaded " + htmlLoaded);
      }
    },

    serveFromCache = function (foldername, host, expires, cb) {
      var getBestFromCache = function () {

        var bestFit = null;
        var bestFitDifference = -100000;
       // Cache dir exists and is valid, read from cache
        DEBUG && console.log("Read files for dir " + foldername);
        fs.readdir(foldername, function (err, files) {

          if (err) {
            console.log("serveFromCache", "Cannot read folder " + foldername);
            cb();
            return;
          }
          for (var i in files) {
            var file = files[i];
            var width = file.split(".")[1];

            // Exact fits are best
            if (size == width) {
              DEBUG && console.log("   ++++ Returning perfect fit for host " + host + ": " + file + " width " + width);
              loadIcon (foldername + file, response);
              return true;
            } 

            // Otherwise, prefer something close to the required size
            var difference = width - size;

            // Positive difference means this image is bigger
            if (difference > bestFitDifference && bestFitDifference > 0) {
              continue;
            }
            if (difference > bestFitDifference) {
              bestFitDifference = difference;
              bestFit = file;
            }
            DEBUG && console.log("   ++ Looking at output file " + i + ", " + file + " width " + width + ", diff " + difference + ", bfd " + bestFitDifference);
          }


          if (!bestFit) {
            // No fitting file was found in cache
            sendEmpty (response);
          }
          DEBUG && console.log("   ++++ Returning best fit for host " + host + ": " + bestFit + " bestFit " + bestFitDifference);
          loadIcon (foldername + bestFit, response);
        });
      };

      if (expires) {
        fs.stat(foldername, function (error, stats) {
          if (error) {
            console.log("serveFromCache", "Cannot stat", error)
            cb ();
            return;
          } else {
            var mtime = stats.mtime.getTime();
            if (mtime < expires) {
              DEBUG && console.log ("Expire check failed for folder " + foldername, mtime, expires);
              cb();
              return;
            }
            getBestFromCache();
          }
        });
      } else {
        getBestFromCache();
      }
    };


  if (!/http[s]*:\/\//.test(root)) {
    root = 'http://' + root;
  }
  var rootObj = url.parse(root);
  var protocol = rootObj.protocol;
  host = rootObj.host;
  root = rootObj.protocol + '//' + host;


  var getRootFavicon = function (root, filename) {
    // expected++;
    var rootFavicon = {
      'url': root + "/" + filename
    };
    // Not expired or not in cache, fetch
    getFavicon(rootFavicon, function (faviconObj) {
      // If we got one, save it to disk and return it.
      if (faviconObj.data) {
        DEBUG && console.log("Root favicon " + filename + " found for " + root);
        done(faviconObj);
      } else {
        DEBUG && console.log("Root favicon " + filename + " NOT found for " + root);
        done();
      }
    });  
  }

  var retrieveAllFavicons = function () {
    getRootFavicon (root, "favicon.ico");
    getRootFavicon (root, "apple-touch-icon.png");
    getRootFavicon (root, "apple-touch-icon-precomposed.png");

    // Try fetching the HTML and parsing it for the favicon.
    getHTML(root, function (html) {
      // If we have HTML, parse out the favicon link.
      if (html) {
        var faviconURLs = parseFaviconURL(html, root, protocol );
        // If we have a favicon URL, try to get it.
        if (faviconURLs && faviconURLs.length > 0) {
          DEBUG && console.log('Found favicon for ' + root + ' in HTML: ' + JSON.stringify(faviconURLs));
          expected += (faviconURLs.length);
          htmlLoaded = true;
          for (i in faviconURLs) {
            var faviconObj = faviconURLs[i];
            DEBUG && console.log("  Retrieving " + faviconObj.url + " for " + root);
            getFavicon(faviconObj, function (faviconObj) {
              if (faviconObj.data) {
                DEBUG && console.log ("Favicon " + faviconObj.url + " found for " + root);
                done(faviconObj);
              } else {
                DEBUG && console.log ("Favicon " + faviconObj.url + " NOT found for " + root);
                done();
              }
            });
          }
        } else {
          htmlLoaded = true;
          DEBUG && console.log('Favicon from HTML not downloaded: ' + root);
          done();
        }
      } else {
        htmlLoaded = true;
        DEBUG && console.log('No HTML returned: ' + root);
        done();
      }
    }, protocol, root);
  }

  var cacheDir = __dirname + '/favicons/' + host + "/";
  fs.exists(cacheDir, function (exists) {
    if (!exists) {
      DEBUG && console.log("Creating favicon dir", cacheDir);
      fs.mkdir(cacheDir, function (error) {
        retrieveAllFavicons();
      });
    } else {
      var expires = (new Date()).getTime() - CACHE_TTL;
      // Check if we have the favicon in our cache
      serveFromCache (cacheDir, host, expires, retrieveAllFavicons);
    }
  });

}).listen(8081, '0.0.0.0');

console.log('Server running at http://localhost:8081/.');
