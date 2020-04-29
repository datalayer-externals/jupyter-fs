# *****************************************************************************
#
# Copyright (c) 2019, the jupyter-fs authors.
#
# This file is part of the jupyter-fs library, distributed under the terms of
# the Apache License 2.0.  The full license can be found in the LICENSE file.
#
from hashlib import md5
import json
from tornado import web

from notebook.base.handlers import APIHandler
from notebook.services.contents.largefilemanager import LargeFileManager
from notebook.services.contents.manager import ContentsManager

from .pyfilesystem_manager import PyFilesystemContentsManager
from .pathutils import path_first_arg, path_second_arg, path_kwarg, path_old_new

__all__ = ["MetaContentsHandler", "MetaContentsManager"]


class MetaContentsManager(ContentsManager):
    def __init__(self, **kwargs):
        self.resources = []

        self._default_cm = ('', LargeFileManager(**kwargs))

        self._contents_managers = dict([self._default_cm])

        # remove kwargs not relevant to pyfs
        kwargs.pop('parent')
        kwargs.pop('log')
        self._kwargs = kwargs

    def initResource(self, *spec, verbose=True):
        """initialize one or more triples representing a PyFilesystem resource specification
        """
        self.resources = []
        managers = dict([self._default_cm])

        for s in spec:
            # get deterministic hash of PyFilesystem url
            _hash = md5(s['fsurl'].encode('utf-8')).hexdigest()[:8]

            if _hash in self._contents_managers:
                # reuse existing cm
                managers[_hash] = self._contents_managers[_hash]
            elif _hash in managers:
                # don't add redundant cm
                pass
            else:
                # create new cm
                managers[_hash] = PyFilesystemContentsManager(s['fsurl'], **self._kwargs)

            # assemble resource from spec + hash
            r = {'drive': _hash}
            r.update(s)
            self.resources.append(r)

        # replace existing contents managers with new
        self._contents_managers = managers

        if verbose:
            print('jupyter-fs initialized: {} file system resources, {} managers'.format(len(self.resources), len(self._contents_managers)))

        return self.resources

    @property
    def root_manager(self):
        return self._contents_managers.get('')

    is_hidden = path_first_arg('is_hidden', False)
    dir_exists = path_first_arg('dir_exists', False)
    file_exists = path_kwarg('file_exists', '', False)
    exists = path_first_arg('exists', False)

    save = path_second_arg('save', 'model', True)
    rename = path_old_new('rename', False)

    get = path_first_arg('get', True)
    delete = path_first_arg('delete', False)

    create_checkpoint = path_first_arg('create_checkpoint', False)
    list_checkpoints = path_first_arg('list_checkpoints', False)
    restore_checkpoint = path_second_arg(
        'restore_checkpoint',
        'checkpoint_id',
        False,
    )
    delete_checkpoint = path_second_arg(
        'delete_checkpoint',
        'checkpoint_id',
        False,
    )

class MetaContentsHandler(APIHandler):
    @property
    def config_specs(self):
        return self.config.get('jupyterfs', {}).get('specs', [])

    @web.authenticated
    async def get(self):
        """Returns all the available contents manager prefixes

        e.g. if the contents manager configuration is something like:
        {
            "file": LargeFileContentsManager,
            "s3": S3ContentsManager,
            "samba": SambaContentsManager
        }

        the result here will be:
        ["file", "s3", "samba"]

        which will allow the frontent to instantiate 3 new filetrees, one
        for each of the available contents managers.
        """
        self.finish(json.dumps(self.contents_manager.resources))

    @web.authenticated
    async def post(self):
        # will be a list of resource dicts
        specs = self.get_json_body()

        self.finish(json.dumps(
            self.contents_manager.initResource(*self.config_specs, *specs)
        ))
