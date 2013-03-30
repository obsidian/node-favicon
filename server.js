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

// Create the favicons directory.
if (!fs.existsSync(__dirname + '/favicons/')) {
  console.log("Creating favicon dir");
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
  if (/https:\/\//.test(url)) {
    protocol = https;
  } else {
    protocol = http;
  }
  protocol.get(url, function (res) {

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
      console.log("Redirecting to: " + res.headers['location']);
      faviconObj.url = res.headers['location'];
      getFavicon(faviconObj, callback);
    } else {
      console.log("Favicon not found: " + url);
      callback(faviconObj); // undefined
    }
  }).on('error', function (err) {
    console.log("Error retrieving favicon " + url + ": " + err.message);
    callback(faviconObj); // undefined
  });
}

function saveFavicon(filename, favicon) {
  fs.writeFileSync(filename, favicon);
    /* if (err) {
      console.log('Error saving favicon: ' + filename);
      console.log(err.message);
    } 
  }); */
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

function loadIcon (file, response) {
  // console.log(host + '.ico file stats: ', stats);
  fs.readFile(file, function (err, favicon) {
    if (!err) {
      response.writeHead(200, {'Content-Type': 'image/png'});
      response.end(favicon);
    } else {
      console.log('   EEEEEEEEE   Error reading ' + file);
      console.log(err.message);
      response.end();
    }
  });
}

// Initialize HTTP server.
http.globalAgent.maxSockets = Number.MAX_VALUE;
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
      response.writeHead(200, {'Content-Type': 'image/x-icon'});
      response.end(defaultFavicon);
      return;
  }

  console.log("REQUEST");

  var host,

    rootFavicon,
    htmlFavicon,

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
            console.log ("done", "Favicon already known, skipping");
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
        console.log(" done() for " + root);

        if (stored == 0) {
          response.end();
        }
        var bestFound = false;
        var toReturn = null;
        for (var i in favicons) {
          // TODO: Eliminate duplicates based on MD5
          var fi = favicons[i].data, orders;
          var foldername = __dirname + '/favicons/' + host + "/";
          var filename = __dirname + '/favicons/tmp/' + host + '-tmp-' + i + '.ico';
          saveFavicon(filename, fi);
          if (favicons[i].bgcolor) {
            orders = [filename, "-background", favicons[i].bgcolor, "-alpha", "on", "-flatten", "-set", "filename:area", "%w", foldername + i + '.%[filename:area].png'];
          } else {
            orders = [filename, "-alpha", "on", "-set", "filename:area", "%w", foldername + i + '.%[filename:area].png'];
          }
          console.log ("*** Saved " + i + "/" + stored + " to " + filename, orders, favicons[i]);
          // fs.rename(__dirname + '/favicons/' + filename, __dirname + '/favicons/' + host + '-' + size + '-' + i + '.ico', function (err) {
          imagemagick.convert(orders, function (err, stdout) {
            converted++;
            if (err) {
              console.log("Cannot convert", filename, foldername + '%[filename:area].png', err, stdout);
              return;
            }
            /* try {
              fs.unlinkSync(filename);
            } catch (ex) {
              console.log("Couldn't unlink ico file after conversion", ex, filename);
            } */
            console.log(" - Converted " + converted + "/" + stored + ": " + orders[0], stdout);
            if (converted == stored) {
              serveFromCache(foldername, host);
            }
          });
        }
      } else {
        console.log(" done() for " + root + ", stored " + stored + ", E " + expected + ", R " + returned + ", still expecting " + (expected - returned) + ", html loaded " + htmlLoaded);
      }
    },

    serveFromCache = function (foldername, host, expires) {
      var files = fs.readdirSync(foldername);
      var bestFit = null;
      var bestFitDifference = -100000;

      if (expires) {
        var stats = fs.statSync(foldername);
        var mtime = stats.mtime.getTime();
        if (mtime < expires) {
          console.log ("Expire check failed for folder " + foldername, mtime, expires);
          return false;
        }
      }

      console.log("Read files for dir " + foldername);

      for (var i in files) {
        var file = files[i];
        var width = file.split(".")[1];

        // Exact fits are best
        if (size == width) {
          console.log("   ++++ Returning perfect fit for host " + host + ": " + file + " width " + width);
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
        console.log("   ++ Looking at output file " + i + ", " + file + " width " + width + ", diff " + difference + ", bfd " + bestFitDifference);
      }


      if (!bestFit) {
        // No fitting file was found in cache
        response.writeHead(200, {'Content-Type': 'image/x-icon'});
        response.end(defaultFavicon);
      }
      console.log("   ++++ Returning best fit for host " + host + ": " + bestFit + " bestFit " + bestFitDifference);
      loadIcon (foldername + bestFit, response);
      return true;
    };


  if (!/http[s]*:\/\//.test(root)) {
    root = 'http://' + root;
  }
  var rootObj = url.parse(root);
  var protocol = rootObj.protocol;
  host = rootObj.host;
  root = rootObj.protocol + '//' + host;

  var cacheDir = __dirname + '/favicons/' + host + "/";
  if (!fs.existsSync(cacheDir)) {
    console.log("Creating favicon dir", cacheDir);
    fs.mkdirSync(cacheDir);
  } else {
    var expires = (new Date()).getTime() - (24 * 60 * 60 * 1000);  // One day in ms
    // Check if we have the favicon in our cache
    if (serveFromCache (cacheDir, host, expires)) {
      return;
    }
  }

  var getRootFavicon = function (root, filename) {
    // expected++;
    var rootFavicon = {
      'url': root + "/" + filename
    };
    // Not expired or not in cache, fetch
    getFavicon(rootFavicon, function (faviconObj) {
      // If we got one, save it to disk and return it.
      if (faviconObj.data) {
        console.log("Root favicon " + filename + " found for " + root);
        done(faviconObj);
      } else {
        console.log("Root favicon " + filename + " NOT found for " + root);
        done();
      }
    });  
  }

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
        console.log('Found favicon for ' + root + ' in HTML: ' + JSON.stringify(faviconURLs));
        expected += (faviconURLs.length);
        htmlLoaded = true;
        for (i in faviconURLs) {
          var faviconObj = faviconURLs[i];
          console.log("  Retrieving " + faviconObj.url + " for " + root);
          getFavicon(faviconObj, function (faviconObj) {
            if (faviconObj.data) {
              console.log ("Favicon " + faviconObj.url + " found for " + root);
              done(faviconObj);
            } else {
              console.log ("Favicon " + faviconObj.url + " NOT found for " + root);
              done();
            }
          });
        }
      } else {
        htmlLoaded = true;
        console.log('Favicon from HTML not downloaded: ' + root);
        done();
      }
    } else {
      htmlLoaded = true;
      console.log('No HTML returned: ' + root);
      done();
    }
  }, protocol, root);
}).listen(8080, 'localhost');

console.log('Server running at http://localhost:8080/.');
