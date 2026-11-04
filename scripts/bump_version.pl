#!/bin/perl

my $version = "$ARGV[0]";

if ($version eq "") {
  print "Need pass version.\n";
  exit 1;
}

if ($version !~ /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/) {
  print "Not a version: $version\n";
  exit 1;
}

my $versionField = qr/^(\s*"version":\s*")([^"]+)(")/m;

sub read_file {
  my ($path) = @_;
  open(my $in, "<", $path) or die "Cannot read $path: $!\n";
  local $/;
  return scalar <$in>;
}

# The manifest's own "version" field, and nothing else: a dependency can carry
# the same number. The previous version comes from package.json because the
# latest git tag is not reliable: fetching the original project brings its tags.
sub set_version {
  my ($path) = @_;
  my $text = read_file($path);
  $text =~ s/$versionField/$1$version$3/ or die "No version field in $path\n";
  open(my $out, ">", $path) or die "Cannot write $path: $!\n";
  print $out $text;
  close($out) or die "Cannot write $path: $!\n";
}

my ($prevVersion) = read_file("./package.json") =~ /$versionField/ ? $2 : "";

printf("Bump %s to %s version.\n", $prevVersion, $version);

set_version("./package.json");
set_version("./src/package.json");

# The Flatpak manifest names the tag it builds. Left stale it still builds fine —
# it just packages the previous release — so it is rewritten here, not by hand.
if (system("python3 ./scripts/sync_flatpak_release.py --version $version") != 0) {
  print "Flatpak metadata could not be updated — nothing committed.\n";
  exit 1;
}

# Commit only what this script wrote: `git add .` used to sweep unrelated
# work-in-progress from the tree into the release commit.
my $files = join(" ", qw(
  package.json
  src/package.json
  flatpak/package.json
  flatpak/app.borys.FigmaLinuxNext.yml
  flatpak/app.borys.FigmaLinuxNext.metainfo.xml
));
system("git commit -m 'chore(release): bump version to $version' -- $files");
system("git tag -a v$version -m 'Publish v$version release'");
