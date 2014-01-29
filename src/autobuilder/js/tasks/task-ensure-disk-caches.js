// -*- indent-tabs-mode: nil; tab-width: 2; -*-
// Copyright (C) 2013,2014 Colin Walters <walters@verbum.org>
//
// This library is free software; you can redistribute it and/or
// modify it under the terms of the GNU Lesser General Public
// License as published by the Free Software Foundation; either
// version 2 of the License, or (at your option) any later version.
//
// This library is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
// Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public
// License along with this library; if not, write to the
// Free Software Foundation, Inc., 59 Temple Place - Suite 330,
// Boston, MA 02111-1307, USA.

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Format = imports.format;

const GSystem = imports.gi.GSystem;

const Builtin = imports.builtin;
const ArgParse = imports.argparse;
const Task = imports.task;
const ProcUtil = imports.procutil;
const BuildUtil = imports.buildutil;
const LibQA = imports.libqa;
const JsonUtil = imports.jsonutil;
const JSUtil = imports.jsutil;
const GuestFish = imports.guestfish;

const TaskEnsureDiskCaches = new Lang.Class({
    Name: 'TaskEnsureDiskCaches',
    Extends: Task.Task,

    TaskDef: {
        TaskName: "ensure-disk-caches",
        TaskAfter: ['build'],
    },

    _ensureDiskForProduct: function(ref, revision, cancellable) {
	      let refUnix = ref.replace(/\//g, '-');
        let diskDir = this._imageCacheDir.get_child(refUnix);
        GSystem.file_ensure_directory(diskDir, true, cancellable);
        let cachedDisk = null;
        let e = null;
        try {
            e = diskDir.enumerate_children('standard::name', 0, cancellable);
            let info;
            while ((info = e.next_file(cancellable)) != null) {
                let name = info.get_name();
                if (!JSUtil.stringEndswith(name, '.qcow2'))
                    continue;
                cachedDisk = e.get_child(info);
                break;
            }
        } finally {
            if (e) e.close(null);
        }
        
        if (cachedDisk) {
            print("Found cached disk " + cachedDisk.get_path() + " for " + ref);
            return;
        }

        let diskPath = diskDir.get_child(revision + '.qcow2');
        let diskPathTmp = diskDir.get_child(revision + '.qcow2.tmp');
        LibQA.createDisk(diskPathTmp, cancellable);
        let mntdir = Gio.File.new_for_path('mnt');
        GSystem.file_ensure_directory(mntdir, true, cancellable);
        let gfmnt = new GuestFish.GuestMount(diskPathTmp, { partitionOpts: LibQA.DEFAULT_GF_PARTITION_OPTS,
                                                            readWrite: true });
        gfmnt.mount(mntdir, cancellable);
        try {
            let osname = this._products['osname'];
            let originRepoUrl = this._products['repo'];
            LibQA.pullDeploy(mntdir, this.repo, osname, ref, revision, originRepoUrl,
                             cancellable);
        } finally {
            gfmnt.umount(cancellable);
        }
        GSystem.file_rename(diskPathTmp, diskPath, cancellable);
        print("Successfully created disk cache " + diskPath.get_path());
    },

    execute: function(cancellable) {
	      this._imageCacheDir = this.cachedir.get_child('images');
        this._products = JsonUtil.loadJson(this.workdir.get_child('products.json'), cancellable);
        this._productsBuilt = JsonUtil.loadJson(this.builddir.get_child('products-built.json'), cancellable);
        let productTrees = this._productsBuilt['trees'];
        for (let ref in productTrees) {
            this._ensureDiskForProduct(ref, productTrees[ref], cancellable);
        }
    },
});