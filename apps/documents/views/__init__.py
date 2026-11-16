from shared.services.workspace_renderer import workspace_view


def register_routes(router):
    router.add('/documents', lambda params: workspace_view(params, 'documents'), name='documents', title='Documentos', layout='blank', show_in_sidebar=False)
