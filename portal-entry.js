const portal = new URL('./site/', location.href);
portal.search = location.search;
portal.hash = location.hash;
location.replace(portal.href);
